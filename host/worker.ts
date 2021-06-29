/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import { ErrorDetails } from "./result.ts";
import {
  InvokeMessage,
  InvokeResultMessage,
  LoadMessage,
  LoadResultMessage,
  PluginMessage,
} from "./worker_api.ts";
import { logBuffer } from "./worker_log.ts";

// The loaded plugin module.
let plugin: { [func: string]: (arg: unknown) => unknown };

self.onmessage = async (e: MessageEvent<PluginMessage>) => {
  switch (e.data.kind) {
    case "load": {
      const result = await load(e.data);
      self.postMessage(result);
      return;
    }
    case "invoke": {
      const result = await invoke(e.data);
      self.postMessage(result);
      return;
    }
  }
};

async function load(msg: LoadMessage): Promise<LoadResultMessage> {
  const result: LoadResultMessage = {
    kind: "load",
    success: false,
    functionNames: [],
  };

  if (plugin) {
    result.error = createError("plugin is already loaded");
    return result;
  }

  try {
    plugin = await import(msg.module);
    result.success = true;
    for (const fn in plugin) {
      if (plugin[fn] instanceof Function) {
        result.functionNames.push(fn);
      }
    }
  } catch (e) {
    result.error = createError(e);
  }
  return result;
}

async function invoke(msg: InvokeMessage): Promise<InvokeResultMessage> {
  const result: InvokeResultMessage = {
    kind: "invoke",
    cid: msg.cid,
    value: undefined,
    logs: [],
  };

  if (!plugin) {
    result.error = createError("plugin is not loaded");
    return result;
  }

  const fn = plugin[msg.function];
  if (!(fn instanceof Function)) {
    result.error = createError(`missing or invalid function "${msg.function}"`);
    return result;
  }

  try {
    result.value = await Promise.resolve(fn(msg.argument));
  } catch (e) {
    result.error = createError(e);
  }
  result.logs = logBuffer.take();
  return result;
}

/**
 * Creates a ErrorDetails object.
 *
 * @param e The error object or message
 * @param name The error name
 * @returns The error
 */
function createError(e: unknown) {
  const err = (e instanceof Error) ? e : new Error(String(e));
  const result: ErrorDetails = { name: err.name, message: err.message };
  if (err.stack) {
    result.stack = err.stack;
  }
  return result;
}
