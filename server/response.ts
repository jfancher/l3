import { ErrorDetails, FetchRecord, LogRecord } from "../host/result.ts";

export type { ErrorDetails, FetchRecord, LogRecord };

/** Response to a /status request. */
export interface StatusResponse {
  /** The plugin module. */
  module: string;

  /**
   * The server status.
   *
   * These statuses are currently defined:
   *
   * | Status      | Code | Description                          |
   * | ----------- | ---- | ------------------------------------ |
   * | OK          | 200  | Ready to serve invocation requests   |
   * | Loading     | 503  | Module is being loaded               |
   * | LoadFailed  | 500  | Loading failed with a runtime error  |
   */
  status: keyof typeof SERVER_STATUS;

  /** The plugin load error, if any. */
  error?: ErrorDetails;

  /** The available function names, if loading succeeded. */
  functionNames?: string[];

  /** The current memory usage of the process. */
  // TODO: Replace with Deno.MemoryUsage in 1.12+.
  memoryUsage?: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
}

/** Maps server status strings to HTTP status codes. */
export const SERVER_STATUS = {
  "OK": 200,
  "Loading": 503,
  "LoadFailed": 500,
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
  result: unknown;

  /** The invocation error, if any. */
  error?: ErrorDetails;

  /** Any messages logged during the invocation. */
  logs: LogRecord[];

  /** Records of fetches performed during the invocation. */
  fetches: FetchRecord[];
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
