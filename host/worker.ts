/** A message used to communicate with the worker. */
export type PluginMessage = LoadMessage | InvokeMessage | CloseMessage;

/** The result of of a `PluginMessage` operation. */
export type PluginResult = LoadResult | InvokeResult;

/**
 * A serializable error object.
 * 
 * @remarks
 * Used as a plain object, not an actual Error. Error types are said to support structured cloning
 * in v8, but that doesn't seem to be the case in Deno. Errors are converted to a plain object to
 * successfully pass through `postMessage`.
 */
export interface PluginError {
  /** The error name. */
  name: string;

  /** The error message. */
  message: string;

  /** The error call stack. */
  stack?: string;
}

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
export interface LoadResult {
  /** Specifies the kind of the message. */
  kind: "load";

  /** The load error, if any. */
  error?: PluginError;
}

/**
 * A request to invoke a plugin function.
 * 
 * A plugin must be loaded before any plugin functions are invoked; otherwise an error will be
 * returned. The result will be posted as an `InvokeResult`.
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
export interface InvokeResult {
  /** Specifies the kind of the message. */
  kind: "invoke";

  /** The correlation id passed in with the `InvokeMessage`. */
  cid: string;

  /** The return value of the function. */
  value?: unknown;

  /** The invocation error, if any. */
  error?: PluginError;
}

/**
 * A request to stop the worker.
 */
export interface CloseMessage {
  kind: "close";
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
      // TODO: support async invoke?
      const result = invoke(e.data);
      self.postMessage(result);
      return;
    }
    case "close": {
      self.close();
      return;
    }
  }
};

async function load(msg: LoadMessage): Promise<LoadResult> {
  const result: LoadResult = { kind: "load" };

  if (plugin) {
    result.error = pluginError("plugin is already loaded");
    return result;
  }

  try {
    plugin = await import(msg.module);
  } catch (e) {
    result.error = pluginError(e);
  }
  return result;
}

function invoke(msg: InvokeMessage): InvokeResult {
  const result: InvokeResult = { kind: "invoke", cid: msg.cid };

  if (!plugin) {
    result.error = pluginError("plugin is not loaded");
    return result;
  }

  const fn = plugin[msg.function];
  if (!(fn instanceof Function)) {
    result.error = pluginError(
      `missing or invalid function "${msg.function}"`,
    );
    return result;
  }

  try {
    result.value = fn(msg.argument);
  } catch (e) {
    result.error = pluginError(e);
  }
  return result;
}

/**
 * Creates a PluginError that can be posted back to the host.
 * 
 * @param e The error object or message
 * @returns The plugin error
 */
function pluginError(e: unknown) {
  // TODO: is there a more standard/general way to do this?
  const err = (e instanceof Error) ? e : new Error(String(e));
  const result: PluginError = { name: err.name, message: err.message };
  if (err.stack) {
    result.stack = err.stack;
  }
  return result;
}
