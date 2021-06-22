import { ErrorDetails, InvokeResult, LoadResult } from "./result.ts";
import { logBuffer } from "./worker_log.ts";

/** A message used to communicate with the worker. */
export type PluginMessage = LoadMessage | InvokeMessage;

/** The result of of a `PluginMessage` operation. */
export type PluginResultMessage = LoadResultMessage | InvokeResultMessage;

/**
 * A request to load a plugin module into the worker.
 *
 * A plugin must be loaded before any plugin functions are invoked, and a plugin must only be
 * loaded once. The result will be posted as a `LoadResult`.
 */
export interface LoadMessage {
  /** Specifies the kind of the message. */
  kind: "load";

  /** The path of the module to load. */
  module: string;
}

/**
 * The result of loading a plugin.
 */
export interface LoadResultMessage extends LoadResult {
  /** Specifies the kind of the message. */
  kind: "load";
}

/**
 * A request to invoke a plugin function.
 *
 * A plugin must be loaded before any plugin functions are invoked; otherwise an error will be
 * returned. The result will be posted as an `InvokeResultMessage`.
 */
export interface InvokeMessage {
  /** Specifies the kind of the message. */
  kind: "invoke";

  /** A correlation id, used to identify the corresponding `InvokeResult`. */
  cid: string;

  /** The path of the module to load. */
  function: string;

  /** The argument to pass to the function. */
  argument: unknown;
}

/**
 * The result of invoking a plugin function.
 */
export interface InvokeResultMessage extends InvokeResult {
  /** Specifies the kind of the message. */
  kind: "invoke";

  /** The correlation id passed in with the `InvokeMessage`. */
  cid: string;
}

// The loaded plugin module.
let plugin: { [func: string]: (arg: unknown) => unknown };

// Tell the IDE that self is a WorkerGlobalScope.
// This could be done with tsconfig, but this seems to be discouraged; there might be a better way
// to configure 'lib', but the documentation is incomplete:
//  https://deno.land/manual@v1.9.2/typescript/configuration#using-the-quotlibquot-property
declare var self: typeof globalThis & {
  onmessage?: (ev: MessageEvent) => unknown;
  postMessage: (message: unknown) => void;
  close: () => void;
};

self.onmessage = async (e: MessageEvent<PluginMessage>) => {
  switch (e.data.kind) {
    case "load": {
      const result = await load(e.data);
      self.postMessage(result);
      return;
    }
    case "invoke": {
      invoke(e.data).then((result) => self.postMessage(result));
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
