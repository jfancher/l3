import { Plugin } from "./plugin.ts";
import { InvokeResult, LoadResult } from "./result.ts";

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

  /** The plugin definition.. */
  plugin: Plugin;
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

  /** An opaque token to be passed back with the corresponding `InvokeResult`. */
  token: string;

  /** A caller-provided identifier for the invocation. */
  invocationId?: string;

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

  /** The token passed in with the `InvokeMessage`. */
  token: string;
}
