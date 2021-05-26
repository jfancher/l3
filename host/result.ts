/** The result of loading a plugin. */
export interface LoadResult {
  /** Whether the load succeeded. */
  success: boolean;

  /** Exported function names. */
  functionNames: string[];

  /** The error encountered, if any. */
  error?: ErrorDetails;
}

/** The result of a function invocation. */
export interface InvokeResult {
  /** The return value of the invocation. */
  value?: unknown;

  /** The error encountered, if any. */
  error?: ErrorDetails;
}

/**
 * A serializable error object.
 * 
 * @remarks
 * Used as a plain object, not an actual Error. Instances of the Error class lose data when passed
 * through a worker boundary (even though they're said to support structured cloning) and don't
 * support conversion to JSON.
 */
export interface ErrorDetails {
  /** The error name. */
  name: string;

  /** The error message. */
  message: string;

  /** The error call stack. */
  stack?: string;
}
