import {
  Deferred,
  deferred,
  delay,
} from "https://deno.land/std@0.95.0/async/mod.ts";
import { v4 as uuidV4 } from "https://deno.land/std@0.95.0/uuid/mod.ts";
import { Plugin } from "./plugin.ts";
import { ErrorDetails, InvokeResult, LoadResult } from "./result.ts";
import { LoadMessage, PluginResultMessage } from "./worker_api.ts";

// Delay for the worker reload loop.
const RELOAD_DELAY_MS = 30_000;

// Number of workers that can fail to load before we stop trying.
const MAX_LOAD_FAILURES = 3;

/** Hosts a plugin instance. */
export class PluginHost {
  #plugin: Plugin;
  #loadSuccess?: LoadResult;
  #loadFailure?: LoadResult;

  // State:
  //  #state starts as 'loading'
  //  After any worker is loaded, #state becomes 'ready' and #started completes
  //  If MAX_LOAD_FAILURES workers fail to load in a row, #state becomes 'failed'
  //    If #started hasn't completed yet, it's rejected
  //  On shutdown(), #state becomes 'closing'
  //  On terminate() (directly or in shutdown), #state becomes 'closed' and #shutdown completes
  #state: PluginHostStatus["state"];
  #started: Deferred<void>;
  #shutdown: Deferred<void>;

  // Worker Pool:
  //  #workers contains all workers (up to the plugin's concurrency limit)
  //  #idle contains those which are loaded and ready to serve the next invoke request
  //  #waiters contains invocations waiting for a worker to be ready
  //  When a load or invoke finishes, the worker is provided to #waiters if any, else #idle
  //  When a load fails or invoke is aborted, the worker is shut down and #reload is signaled
  //  See #maintainPool for the load/reload details
  #workers: Set<Worker>;
  #idle: Worker[];
  #waiters: Deferred<Worker>[];
  #reload: Deferred<void>;

  #invocations = 0;
  #invoked: Map<string, Deferred<InvokeResult>>;

  constructor(plugin: Plugin) {
    this.#plugin = plugin;
    this.#state = "loading";
    this.#workers = new Set();
    this.#idle = [];
    this.#waiters = [];
    this.#invoked = new Map();
    this.#started = deferred();
    this.#shutdown = deferred();
    this.#reload = deferred();
    this.#maintainPool();
  }

  /** The current status of the host. */
  get status(): PluginHostStatus {
    return {
      state: this.#state,
      workers: this.#workers.size,
      idle: this.#idle.length,
      invocations: this.#invocations,
      functionNames: this.#loadSuccess?.functionNames ?? [],
      loadError: this.#loadFailure?.error,
    };
  }

  /** Returns a promise that completes when initial plugin loading is done. */
  async ensureLoaded() {
    await this.#started;
  }

  /**
   * Invokes a plugin function.
   *
   * @param func The function name
   * @param argument The argument
   * @param opts Configures the invocation
   * @returns The function result
   */
  async invoke(
    func: string,
    argument: unknown,
    opts?: InvokeOptions,
  ): Promise<InvokeResult> {
    if (this.#state !== "ready") {
      throw new Error("invalid host state");
    }

    const cid = uuidV4.generate();
    const result = deferred<InvokeResult>();
    this.#invoked.set(cid, result);
    this.#invocations++;

    opts?.signal?.addEventListener("abort", () => {
      this.#completeInvoke(cid, {
        error: {
          name: "AbortError",
          message: "Invocation was aborted",
        },
      });
    });

    const worker = await this.#nextWorker(opts?.signal);
    if (!worker) {
      return await result; // should be completed as aborted
    }

    worker.postMessage({
      kind: "invoke",
      cid: cid,
      function: func,
      argument: argument,
    });

    const value = await result;

    if (opts?.signal?.aborted) {
      this.#workerFailed(worker);
    } else {
      this.#workerReady(worker);
    }

    return value;
  }

  /** Resolves an invocation promise and removes it from the in-progress map. */
  #completeInvoke(cid: string, result: Partial<InvokeResult>) {
    const p = this.#invoked.get(cid);
    if (p) {
      const r: InvokeResult = {
        value: result.value ?? undefined,
        logs: result.logs ?? [],
      };
      if (result.error) {
        r.error = result.error;
      }
      p.resolve(r);
      this.#invoked.delete(cid);
    }
  }

  /** Shuts down the host after any in-flight requests complete. */
  async shutdown() {
    if (this.#state === "closing") {
      throw new Error("invalid host state");
    }
    if (this.#state === "closed") {
      return;
    }
    this.#state = "closing";
    await Promise.allSettled(this.#invoked.values());
    this.terminate();
  }

  /** Immediately terminates the plugin and aborts any in-flight requests. */
  terminate() {
    if (this.#state !== "closed") {
      this.#state = "closed";
      for (const cid of this.#invoked.keys()) {
        this.#completeInvoke(cid, {
          error: {
            name: "TerminateError",
            message: "Worker was terminated",
          },
        });
      }
      this.#invoked.clear();
      for (const worker of this.#workers) {
        worker.terminate();
      }
      this.#shutdown.resolve();
    }
  }

  /** Starts the worker pool and refills it as needed. */
  async #maintainPool() {
    const size = Math.max(1, this.#plugin.concurrency ?? 0);

    const running = () => this.#state === "loading" || this.#state === "ready";
    let failureCount = 0;

    do {
      while (this.#workers.size < size) {
        const [worker, result] = await this.#createWorker();

        // shutdown may have happened while loading; just discard the worker if so
        if (!running()) {
          worker.terminate();
          break;
        }

        if (result.success) {
          failureCount = 0;
          this.#workers.add(worker);
          this.#workerReady(worker);
          if (this.#state === "loading") {
            this.#state = "ready";
            this.#started.resolve();
          }
        } else {
          this.#workerFailed(worker);
          failureCount++;
          if (failureCount >= MAX_LOAD_FAILURES) {
            switch (this.#state) {
              case "loading":
                this.#started.reject(new Error("loading failed"));
                // fallthrough
              case "ready":
                this.#state = "failed";
            }
          }
        }
      }

      await Promise.race([this.#shutdown, this.#reload]);
      if (running()) {
        // reset the reload trigger
        this.#reload = deferred();

        // if all workers are down, reload immediately; else wait a bit
        if (this.#workers.size) {
          await delay(RELOAD_DELAY_MS);
        }
      }
    } while (running());
  }

  /**
   * Creates a new worker and loads a plugin into it.
   *
   * @returns The worker and its load result
   */
  async #createWorker(): Promise<[Worker, LoadResult]> {
    const loaded = deferred<LoadResult>();
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      "type": "module",
    });

    worker.onmessage = (e: MessageEvent<PluginResultMessage>) => {
      switch (e.data.kind) {
        case "load": {
          const result: LoadResult = {
            success: e.data.success,
            functionNames: e.data.functionNames,
          };
          if ("error" in e.data) {
            result.error = e.data.error;
          }
          loaded.resolve(result);
          return;
        }
        case "invoke": {
          const result: InvokeResult = {
            value: e.data.value,
            logs: e.data.logs,
          };
          if ("error" in e.data) {
            result.error = e.data.error;
          }
          this.#completeInvoke(e.data.cid, result);
          return;
        }
      }
    };

    const msg: LoadMessage = { kind: "load", plugin: this.#plugin };
    worker.postMessage(msg);

    const result = await loaded;
    return [worker, result];
  }

  /** Returns the next available worker, or nothing if aboorted. */
  #nextWorker(signal?: AbortSignal | null): Promise<Worker | void> {
    const worker = this.#idle.shift();
    if (worker) {
      return Promise.resolve(worker);
    }

    const available = deferred<Worker>();
    this.#waiters.push(available);

    const abandoned = deferred<void>();
    signal?.addEventListener("abort", () => {
      abandoned.resolve();
      available.then((w) => this.#workerReady(w));
    });
    return Promise.race([available, abandoned]);
  }

  /** Provides a worker to the next waiter, or adds it to the idle list. */
  #workerReady(worker: Worker) {
    const waiting = this.#waiters.shift();
    if (waiting) {
      waiting.resolve(worker);
    } else {
      this.#idle.push(worker);
    }
  }

  /** Cleans up a failed worker. */
  #workerFailed(worker: Worker) {
    worker.terminate();
    this.#workers.delete(worker);
    this.#reload.resolve();
  }
}

/** Configures a plugin invocation. */
export interface InvokeOptions {
  /** An signal that can cancel the invocation. */
  signal?: AbortSignal | null;
}

/** Describes loading state and some metrics for a plugin host. */
export interface PluginHostStatus {
  /**
   * The overall host state.
   *
   * `loading`: Performing the initial plugin load
   * `ready`: At least one worker is loaded and ready
   * `failed`: All workers have failed and will not be restarted
   * `closing`: Shutdown has begun
   * `closed`: All workers have terminated
   */
  state: "loading" | "ready" | "failed" | "closing" | "closed";

  /** The current worker pool size. */
  workers: number;

  /** The number of idle workers. */
  idle: number;

  /** The number of invocations processed. */
  invocations: number;

  /** The loaded function names, if available. */
  functionNames: string[];

  /** The most recent load error, if any. */
  loadError?: ErrorDetails;
}
