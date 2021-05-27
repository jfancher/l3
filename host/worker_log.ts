import { LevelName, setup } from "https://deno.land/std@0.95.0/log/mod.ts";
import { LogRecord as BaseLogRecord } from "https://deno.land/std@0.95.0/log/logger.ts";
import { BaseHandler, ConsoleHandler } from "https://deno.land/std@0.95.0/log/handlers.ts";
import { LogRecord } from "./result.ts";

/** A log handler which stores log records in a buffer. */
class BufferLogHandler extends BaseHandler {
  #buf: LogRecord[];

  /**
   * Initializes a new BufferLogHandler.
   * 
   * @param level The log level
   */
  constructor(level: LevelName) {
    super(level);
    this.#buf = [];
  }

  /** @inheritdoc */
  handle(rec: BaseLogRecord) {
    if (this.level > rec.level) return;
    this.#buf.push({
      loggerName: rec.loggerName,
      level: rec.levelName,
      message: rec.msg,
    });
  }

  /** Returns and clears the current log buffer. */
  take() {
    const result = this.#buf;
    this.#buf = [];
    return result;
  }
}

/** The log handler used to record plugin worker logs. */
export const logBuffer = new BufferLogHandler("DEBUG");

await setup({
  handlers: {
    default: logBuffer,
    console: new ConsoleHandler("INFO")
  },

  loggers: {
    default: {
      level: "DEBUG",
      handlers: ["default", "console"],
    }
  }
});
