import { Deferred, deferred } from "https://deno.land/std@0.95.0/async/mod.ts";
import { v4 as uuidV4 } from "https://deno.land/std@0.95.0/uuid/mod.ts";
import { InvokeResult, LoadResult } from "./result.ts";
import {
  InvokeMessage,
  LoadMessage,
  PluginResultMessage,
} from "./worker_api.ts";

/** Hosts a plugin instance. */
export class PluginHost {
  #worker: Worker;
  #loaded: Deferred<LoadResult>;
  #invoked: Map<string, Deferred<InvokeResult>>;
  #state: "initial" | "active" | "closing" | "closed";

  constructor() {
    this.#worker = new Worker(new URL("./worker.ts", import.meta.url).href, {
      "type": "module",
    });

    this.#loaded = deferred<LoadResult>();
    this.#invoked = new Map();
    this.#state = "initial";

    this.#worker.onmessage = (e: MessageEvent<PluginResultMessage>) => {
      switch (e.data.kind) {
        case "load": {
          const result: LoadResult = {
            success: e.data.success,
            functionNames: e.data.functionNames,
          };
          if ("error" in e.data) {
            result.error = e.data.error;
          }
          this.#loaded.resolve(result);
          return;
        }
        case "invoke": {
          const result: InvokeResult = {
            value: e.data.value,
            logs: e.data.logs,
          };
          if ("error" in e.data) {
            result.error = e.data.error;
          }
          this.#completeInvoke(e.data.cid, result);
          return;
        }
      }
    };
  }

  /**
   * Loads the plugin module.
   *
   * @param module The module path
   * @returns The load result
   */
  async load(module: string): Promise<LoadResult> {
    if (this.#state !== "initial") {
      throw new Error("invalid host state");
    }
    this.#state = "active";
    const msg: LoadMessage = { kind: "load", module: module };
    this.#worker.postMessage(msg);
    return await this.#loaded;
  }

  /**
   * Invokes the loaded plugin.
   *
   * @param func The function name
   * @param argument The argument
   * @param opts Configures the invocation
   * @returns The function result
   */
  async invoke(
    func: string,
    argument: unknown,
    opts?: InvokeOptions,
  ): Promise<InvokeResult> {
    if (this.#state !== "active") {
      throw new Error("invalid host state");
    }
    const cid = uuidV4.generate();
    const res = deferred<InvokeResult>();
    this.#invoked.set(cid, res);

    opts?.signal?.addEventListener("abort", () => {
      this.#completeInvoke(cid, {
        error: {
          name: "AbortError",
          message: "Invocation was aborted",
        },
      });
    });

    const msg: InvokeMessage = {
      kind: "invoke",
      cid: cid,
      function: func,
      argument: argument,
    };
    this.#worker.postMessage(msg);
    return await res;
  }

  /** Resolves an invocation promise and removes it from the in-progress map. */
  #completeInvoke = (cid: string, result: Partial<InvokeResult>) => {
    const p = this.#invoked.get(cid);
    if (p) {
      const r: InvokeResult = {
        value: result.value ?? undefined,
        logs: result.logs ?? [],
      };
      if (result.error) {
        r.error = result.error;
      }
      p.resolve(r);
      this.#invoked.delete(cid);
    }
  };

  /** Shuts down the host after any in-flight requests complete. */
  async shutdown() {
    if (this.#state === "closing") {
      throw new Error("invalid host state");
    }
    if (this.#state === "closed") {
      return;
    }
    this.#state = "closing";
    await Promise.allSettled(this.#invoked.values());
    this.terminate();
  }

  /** Immediately terminates the plugin and aborts any in-flight requests. */
  terminate() {
    if (this.#state !== "closed") {
      this.#state = "closed";
      for (const cid of this.#invoked.keys()) {
        this.#completeInvoke(cid, {
          error: {
            name: "TerminateError",
            message: "Worker was terminated",
          },
        });
      }
      this.#invoked.clear();
      this.#worker.terminate();
    }
  }
}

/** Configures a plugin invocation. */
export interface InvokeOptions {
  /** An signal that can cancel the invocation. */
  signal?: AbortSignal | null;
}
