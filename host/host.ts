import { Deferred, deferred } from "https://deno.land/std@0.95.0/async/mod.ts";
import { v4 as uuidV4 } from "https://deno.land/std@0.95.0/uuid/mod.ts";
import {
  CloseMessage,
  InvokeMessage,
  LoadMessage,
  PluginError,
  PluginResult,
} from "./worker.ts";

/** Hosts a plugin instance. */
export class PluginHost {
  #worker: Worker;
  #loaded: Deferred<void>;
  #invoked: Map<string, Deferred<unknown>>;

  constructor() {
    this.#worker = new Worker(new URL("./worker.ts", import.meta.url).href, {
      "type": "module",
    });

    this.#loaded = deferred<void>();
    this.#invoked = new Map();

    this.#worker.onmessage = (e: MessageEvent<PluginResult>) => {
      switch (e.data.kind) {
        case "load": {
          if (e.data.error) {
            this.#loaded.reject(deserializeError(e.data.error));
          } else {
            this.#loaded.resolve();
          }
          return;
        }
        case "invoke": {
          const res = this.#invoked.get(e.data.cid);
          if (res) {
            if (e.data.error) {
              res.reject(deserializeError(e.data.error));
            } else {
              res.resolve(e.data.value);
            }
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
   */
  async load(module: string): Promise<void> {
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
  async invoke(func: string, argument: unknown): Promise<unknown> {
    const cid = uuidV4.generate();
    const res = deferred<unknown>();
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

/**
 * Converts a serialized `PluginError` back into a real `Error` object.
 * 
 * @param e The plugin errorr
 * @returns The error object
 */
function deserializeError(e: PluginError): Error {
  const err = new Error(e.message);
  err.name = e.name;
  err.stack = e.stack;
  return err;
}
