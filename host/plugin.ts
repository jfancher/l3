/** Defines a plugin. */
export interface Plugin {
  /** The plugin module import path. */
  module: string;

  /** The plugin identifier, if available. */
  $id?: string;

  /** The account identifier, if available. */
  accountId?: string;

  /** Additional global values to set for plugin invocations. */
  globals?: Record<string, unknown>;

  /** The number of concurrent workers to create. */
  concurrency?: number;
}
