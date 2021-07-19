import { Deferred, deferred } from "https://deno.land/std@0.95.0/async/mod.ts";
import {
  Application,
  RouteParams,
  Router,
  RouterContext,
} from "https://deno.land/x/oak@v7.5.0/mod.ts";
import { InvokeResult, LoadResult, Plugin, PluginHost } from "../host/mod.ts";
import {
  ErrorDetails,
  INVOKE_STATUS,
  InvokeResponse,
  SERVER_STATUS,
  StatusResponse,
} from "./response.ts";

type Ctx = RouterContext<RouteParams, Record<string, unknown>>;

/**
 * Serves a simple HTTP API for a plugin.
 *
 * Exposes the following endpoints:
 *
 * `GET /status`
 *
 * Indicates whether or not the server is ready to serve invocation requests.
 *
 * Returns a {@link StatusResponse}.
 *
 * ---
 *
 * `POST /invoke/:func`
 *
 * Invokes a plugin function.
 *
 * Returns an {@link InvokeResponse}.
 */
export class Server {
  #plugin: Plugin;
  #port: number;
  #host: PluginHost;
  #running: boolean;
  #status: StatusResponse;
  #abort: AbortController;
  #loaded: Deferred<void>;
  #nextHost?: PluginHost;

  /**
   * Initializes a new plugin server.
   *
   * @param plugin The plugin definition
   * @param port The server port
   */
  constructor(plugin: Plugin, port: number = 8080) {
    this.#plugin = plugin;
    this.#port = port;
    this.#host = new PluginHost();
    this.#running = false;
    this.#status = { module: plugin.module, status: "Loading" };
    this.#abort = new AbortController();
    this.#loaded = deferred<void>();
  }

  /** Runs the HTTP server. */
  async run() {
    if (this.#running) {
      throw new Error("Server may only be run once.");
    }

    this.#running = true;
    this.#load();

    const router = new Router();
    router.get("/status", (ctx) => this.#handleStatus(ctx));
    router.post("/invoke/:func", (ctx) => this.#handleInvoke(ctx));

    const app = new Application();
    app.use(router.routes());
    app.use(router.allowedMethods());
    await app.listen({ port: this.#port, signal: this.#abort.signal });
  }

  /** Returns a promise that completes when plugin loading finishes (successfully or not). */
  async ensureLoaded() {
    await this.#loaded;
  }

  /** Stops the HTTP server. */
  stop() {
    this.#abort.abort();
    this.#host.terminate();
    this.#nextHost?.terminate();
  }

  /** Loads the plugin module. */
  async #load() {
    const result = await this.#host.load(this.#plugin);
    this.#updateLoadStatus(result);
    this.#loaded.resolve();
  }

  /** Enqueues a reload of the plugin into a new host, shutting down the current one. */
  #scheduleReload() {
    if (this.#nextHost) {
      return;
    }

    this.#nextHost = new PluginHost();
    (async () => {
      const result = await this.#nextHost!.load(this.#plugin);
      this.#updateLoadStatus(result);
      this.#host = this.#nextHost!;
      this.#nextHost = undefined;
    })();
  }

  /** Updates the host status based when plugin loading completes. */
  #updateLoadStatus(result: LoadResult) {
    if (result.success) {
      this.#status.status = "OK";
      this.#status.functionNames = result.functionNames;
    } else {
      this.#status.status = "LoadFailed";
      this.#status.error = result.error;
    }
  }

  /** GET /status */
  #handleStatus(ctx: Ctx) {
    ctx.response.status = SERVER_STATUS[this.#status.status];
    ctx.response.body = {
      ...this.#status,
      memoryUsage: Deno.memoryUsage(),
    };
  }

  /** POST /invoke/:func */
  async #handleInvoke(ctx: Ctx) {
    const func = ctx.params.func;
    const body: InvokeResponse = {
      module: this.#plugin.module,
      functionName: func ?? "",
      status: "OK",
      result: undefined,
      logs: [],
    };
    ctx.response.body = body;

    const fail = (s: keyof typeof INVOKE_STATUS, err: Error | ErrorDetails) => {
      body.status = s;
      body.error = err;
      if (err instanceof Error) {
        body.error = { name: err.name, message: err.message };
        if (err.stack) {
          body.error.stack = err.stack;
        }
      }
      ctx.response.status = INVOKE_STATUS[s];
    };

    if (!func) {
      fail("NotFound", new Error("missing function argument"));
      return;
    }

    switch (this.#status.status) {
      case "Loading":
        fail("Unavailable", new Error("module is loading"));
        return;
      case "LoadFailed":
        fail("Unavailable", this.#status.error!);
        return;
    }

    let arg: unknown = undefined;
    try {
      const body = ctx.request.body({ type: "json" });
      arg = await body.value;
    } catch (e) {
      const err = (e instanceof Error) ? e : new Error(String(e));
      fail("InvalidArgument", err);
      return;
    }

    if (!this.#status.functionNames?.includes(func)) {
      fail("NotFound", new Error(`function "${func}" does not exist`));
      return;
    }

    // Note: We would like to abort the call when the client disconnects, but we currently don't
    // have a way to detect this (ref: https://github.com/denoland/deno/issues/10829).
    //
    // Instead, for the time being respect the custom X-Timeout header.
    const timeout = Number.parseInt(ctx.request.headers.get("X-Timeout") ?? "");
    const ctl = new AbortController();
    let call = this.#host.invoke(func, arg, { signal: ctl.signal });
    if (timeout) {
      call = this.#configureTimeout(call, ctl, timeout);
    }

    try {
      const result = await call;
      body.result = result.value;
      body.logs = result.logs;
      if (result.error) {
        fail("RuntimeError", result.error);
      }
    } catch (e) {
      const err = (e instanceof Error) ? e : new Error(String(e));
      fail("InternalError", err);
    }
  }

  /**
   * Adds a timeout to a request; if the call doesn't complete in a given number of seconds, the
   * provided abort controller is signalled. The current host will then be terminated and swapped
   * for a new one.
   *
   * @param call The invocation promise
   * @param ctl The abort controller
   * @param msec The timeout, in milliseconds
   */
  async #configureTimeout(
    call: Promise<InvokeResult>,
    ctl: AbortController,
    msec: number,
  ) {
    const timerId = setTimeout(() => ctl.abort(), msec);
    ctl.signal.addEventListener("abort", () => this.#scheduleReload());
    try {
      return await call;
    } finally {
      clearTimeout(timerId);
    }
  }
}
