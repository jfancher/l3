/** Defines a plugin. */
export interface Plugin {
  /** The plugin module import path. */
  module: string;

  /** The plugin identifier, if configured. */
  id?: string;

  /** Additional global values to set for plugin invocations. */
  globals?: Record<string, unknown>;
}
