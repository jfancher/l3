/** Response to a /status request. */
export interface StatusResponse {
  /** The plugin module. */
  module: string;

  /**
   * The server status.
   * 
   * These statuses are currently defined:
   * 
   * | Status  | Code | Description                        |
   * | ------- | ---- | ---------------------------------- |
   * | OK      | 200  | Ready to serve invocation requests |
   * | Loading | 503  | Module is being loaded             |
   * | Failed  | 500  | Loading encountered a fatal error  |
   */
  status: keyof typeof SERVER_STATUS;

  /** The plugin load error, if any. */
  error?: ErrorDetails;
}

/** Maps server status strings to HTTP status codes. */
export const SERVER_STATUS = {
  "OK": 200,
  "Loading": 503,
  "Failed": 500,
} as const;

/** Response to an /invoke/:func request. */
export interface InvokeResponse {
  /** The plugin module. */
  module: string;

  /** The function name. */
  functionName: string;

  /**
   * The invocation status.
   * 
   * These statuses are currently defined:
   * 
   * | Status          | Code | Description                        |
   * | --------------- | ---- | ---------------------------------- |
   * | OK              | 200  | Successful invocation              |
   * | Unavailable     | 503  | Plugin is not loaded (see /status) |
   * | NotFound        | 404  | Requested function does not exist  |
   * | InvalidArgument | 400  | Provided argument is invalid JSON  |
   * | RuntimeError    | 500  | Function threw an error            |
   * | InternalError   | 500  | Internal host error                |
   */
  status: keyof typeof INVOKE_STATUS;

  /** The function's return value, if successful. */
  result?: unknown;

  /** The invocation error, if any. */
  error?: ErrorDetails;
}

/** Maps invoke status strings to HTTP status codes. */
export const INVOKE_STATUS = {
  "OK": 200,
  "Unavailable": 503,
  "NotFound": 404,
  "InvalidArgument": 400,
  "RuntimeError": 500,
  "InternalError": 500,
} as const;

/**
 * Information about an error.
 * 
 * Currently equivalent to the Error interface, but expected to be a plain serializable object.
 */
export interface ErrorDetails {
  /** The error name. */
  name: string;

  /** The error message. */
  message: string;

  /** The error call stack. */
  stack?: string;
}
