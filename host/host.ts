import { Deferred, deferred } from "https://deno.land/std@0.95.0/async/mod.ts";
import { v4 as uuidV4 } from "https://deno.land/std@0.95.0/uuid/mod.ts";
import { InvokeResult, LoadResult } from "./result.ts";
import {
  CloseMessage,
  InvokeMessage,
  LoadMessage,
  PluginResultMessage,
} from "./worker.ts";

/** Hosts a plugin instance. */
export class PluginHost {
  #worker: Worker;
  #loaded: Deferred<LoadResult>;
  #invoked: Map<string, Deferred<InvokeResult>>;

  constructor() {
    this.#worker = new Worker(new URL("./worker.ts", import.meta.url).href, {
      "type": "module",
    });

    this.#loaded = deferred<LoadResult>();
    this.#invoked = new Map();

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
          const p = this.#invoked.get(e.data.cid);
          if (p) {
            const result: InvokeResult = {
              value: e.data.value,
              logs: e.data.logs,
            };
            if ("error" in e.data) {
              result.error = e.data.error;
            }
            p.resolve(result);
            this.#invoked.delete(e.data.cid);
          }
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
    const msg: LoadMessage = { kind: "load", module: module };
    this.#worker.postMessage(msg);
    return await this.#loaded;
  }

  /**
   * Invokes the loaded plugin.
   * 
   * @param func The function name
   * @param argument The argument
   * @returns The function result
   */
  async invoke(func: string, argument: unknown): Promise<InvokeResult> {
    const cid = uuidV4.generate();
    const res = deferred<InvokeResult>();
    this.#invoked.set(cid, res);

    const msg: InvokeMessage = {
      kind: "invoke",
      cid: cid,
      function: func,
      argument: argument,
    };
    this.#worker.postMessage(msg);
    return await res;
  }

  /**
   * Shuts down the plugin.
   */
  close() {
    const msg: CloseMessage = { kind: "close" };
    this.#worker.postMessage(msg);
  }
}
