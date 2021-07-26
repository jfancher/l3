/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import { Plugin } from "./plugin.ts";
import { ErrorDetails } from "./result.ts";
import {
  InvokeMessage,
  InvokeResultMessage,
  LoadMessage,
  LoadResultMessage,
  PluginMessage,
} from "./worker_api.ts";
import {
  closeInvocationContext,
  openInvocationContext,
} from "./worker_context.ts";
import { logBuffer } from "./worker_log.ts";

// The loaded plugin module.
let plugin: Plugin;
let module: { [func: string]: (arg: unknown) => unknown };

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
    openInvocationContext("", msg.plugin.globals);
    module = await import(msg.plugin.module);
    plugin = msg.plugin;
    result.success = true;
    for (const fn in module) {
      if (module[fn] instanceof Function) {
        result.functionNames.push(fn);
      }
    }
  } catch (e) {
    result.error = createError(e);
  } finally {
    closeInvocationContext();
  }
  return result;
}

async function invoke(msg: InvokeMessage): Promise<InvokeResultMessage> {
  const result: InvokeResultMessage = {
    kind: "invoke",
    cid: msg.cid,
    value: undefined,
    logs: [],
    fetches: [],
  };

  if (!plugin) {
    result.error = createError("plugin is not loaded");
    return result;
  }

  const fn = module[msg.function];
  if (!(fn instanceof Function)) {
    result.error = createError(`missing or invalid function "${msg.function}"`);
    return result;
  }

  try {
    openInvocationContext(msg.cid, plugin.globals, {
      fetch: (rec) => result.fetches.push(rec),
    });
    result.value = await Promise.resolve(fn(msg.argument));
  } catch (e) {
    result.error = createError(e);
  } finally {
    closeInvocationContext();
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
