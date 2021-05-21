import { Deferred, deferred } from "https://deno.land/std@0.95.0/async/mod.ts";
import {
  Application,
  RouteParams,
  Router,
  RouterContext,
} from "https://deno.land/x/oak@v7.3.0/mod.ts";
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
    this.#status = { module: mod, status: "Loading" };
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
    try {
      await this.#host.load(this.#mod);
      this.#status.status = "OK";
    } catch (e) {
      this.#status.status = "Failed";
      this.#status.error = this.#convertError(e);
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
    };
    ctx.response.body = body;

    const fail = (s: keyof typeof INVOKE_STATUS, err: unknown) => {
      body.status = s;
      body.error = this.#convertError(err);
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
        fail("Unavailable", this.#status.error);
        return;
    }

    let arg: unknown = undefined;
    try {
      const body = ctx.request.body({ type: "json" });
      arg = await body.value;
    } catch (e) {
      fail("InvalidArgument", e);
      return;
    }

    // TODO: check whether function exists first

    try {
      body.result = await this.#host.invoke(func, arg);
    } catch (e) {
      fail("RuntimeError", e);
      return;
    }
  };

  /** Formats an error value as part of a response. */
  #convertError = (e: unknown) => {
    const err = (e instanceof Error) ? e : new Error(String(e));
    const result: ErrorDetails = { name: err.name, message: err.message };
    if (err.stack) {
      result.stack = err.stack;
    }
    return result;
  };
}
