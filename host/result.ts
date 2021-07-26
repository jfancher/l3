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
  value: unknown;

  /** The error encountered, if any. */
  error?: ErrorDetails;

  /** Any messages logged during the invocation. */
  logs: LogRecord[];

  /** Metadata about fetches performed. */
  fetches: FetchRecord[];
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

/** A logged message. */
export interface LogRecord {
  /** The logger name. */
  loggerName: string;

  /** The log level. */
  level: string;

  /** The message. */
  message: string;
}

/** Metadata about a fetch performed during an invocation. */
export interface FetchRecord {
  /** The request scheme. */
  scheme: string;

  /** The remote host. */
  host: string;

  /** The HTTP method. */
  method: string;

  /** The response status code. */
  status: number;

  /** The response status text. */
  statusText: string;

  /** The time at which the request was made. */
  startTime: string;

  /** The time at which the response was received. */
  endTime: string;

  /** Sent body size. */
  sentBytes: number;

  /** Received body size. */
  receivedBytes: number;
}
