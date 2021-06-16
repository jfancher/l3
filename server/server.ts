import { Deferred, deferred } from "https://deno.land/std@0.95.0/async/mod.ts";
import {
  Application,
  RouteParams,
  Router,
  RouterContext,
} from "https://deno.land/x/oak@v7.5.0/mod.ts";
import { PluginHost } from "../host/mod.ts";
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
  #mod: string;
  #port: number;
  #host: PluginHost;
  #running: boolean;
  #status: StatusResponse;
  #abort: AbortController;
  #loaded: Deferred<void>;

  /**
   * Initializes a new plugin server.
   *
   * @param mod The plugin module path
   * @param port The server port
   */
  constructor(mod: string, port: number = 8080) {
    this.#mod = mod;
    this.#port = port;
    this.#host = new PluginHost();
    this.#running = false;
    this.#status = { module: mod, status: "Loading", functionNames: [] };
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
    router.get("/status", this.#handleStatus);
    router.post("/invoke/:func", this.#handleInvoke);

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
    this.#host.close();
  }

  /** Loads the plugin module. */
  #load = async () => {
    const result = await this.#host.load(this.#mod);
    if (result.success) {
      this.#status.status = "OK";
      this.#status.functionNames = result.functionNames;
    } else {
      this.#status.status = "Failed";
      this.#status.error = result.error;
    }
    this.#loaded.resolve();
  };

  /** GET /status */
  #handleStatus = (ctx: Ctx) => {
    ctx.response.status = SERVER_STATUS[this.#status.status];
    ctx.response.body = this.#status;
  };

  /** POST /invoke/:func */
  #handleInvoke = async (ctx: Ctx) => {
    const func = ctx.params.func;
    const body: InvokeResponse = {
      module: this.#mod,
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
      case "Failed":
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

    if (!this.#status.functionNames.includes(func)) {
      fail("NotFound", new Error(`function "${func}" does not exist`));
      return;
    }

    try {
      const result = await this.#host.invoke(func, arg);
      body.result = result.value;
      body.logs = result.logs;
      if (result.error) {
        fail("RuntimeError", result.error);
      }
    } catch (e) {
      const err = (e instanceof Error) ? e : new Error(String(e));
      fail("InternalError", err);
      return;
    }
  };
}
