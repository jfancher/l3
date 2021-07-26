/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import { FetchRecord } from "./result.ts";

// Set on the global object to indicate the current call id.
const cid = Symbol("cid");

// Overrides a global property.
type Override<K, T> = (
  key: K,
  value: T,
  prop: PropertyDescriptor,
) => PropertyDescriptor;

let current: InvocationContext | null = null;

/**
 * Initializes a restricted global environment for an invocation.
 *
 * The context should be closed with `closeInvocationContext` when the current plugin call is
 * finished to clean up resources, and _must_ be closed before the next call to this function.
 *
 * @param cid The call id
 * @param globals Additional values to add to the global environment
 */
export function openInvocationContext(
  cid: string,
  globals?: Record<string, unknown>,
  logger?: Logger,
) {
  const ctx = new InvocationContext(cid, globals, logger);
  ctx.set(); // will throw if previous was not closed, no need to check current
  current = ctx;
}

/**
 * Cleans up any current invocation global execution environment (created with
 * `openInvocationContext`) and restores global values to their defaults.
 */
export function closeInvocationContext() {
  current?.restore();
  current = null;
}

/** Logs global events that occur during an invocation. */
export interface Logger {
  /** Called when a  */
  fetch?: (rec: FetchRecord) => void;
}

/** Creates a restricted execution environment for a plugin invocation. */
class InvocationContext {
  #cid: string;
  #customGlobals: Record<string, unknown>;
  #orig: Record<PropertyKey, PropertyDescriptor>;
  #timers: Set<number>;
  #abort: AbortController;
  #logger: Logger;

  /**
   * Initializes a new invocation context.
   *
   * @param cid The call id
   * @param globals Additional values to add to the global environment
   * @param logger The event logger
   */
  constructor(cid: string, globals?: Record<string, unknown>, logger?: Logger) {
    this.#cid = cid;
    this.#customGlobals = globals ?? {};
    this.#logger = logger ?? {};
    this.#orig = {};
    this.#timers = new Set();
    this.#abort = new AbortController();
  }

  /** Sets the global environment to the isolated invocation context. */
  set() {
    const env = Object(globalThis);
    if (env[cid]) {
      throw new Error(
        `Cannot reenter context '${this.#cid}' (current: ${env[cid]}).`,
      );
    }

    const globalProps = Object.getOwnPropertyDescriptors(env);
    const overrides = Object(this.#globals);
    for (const key in globalProps) {
      const prop = globalProps[key];
      this.#orig[key] = prop;
      if (key in overrides) {
        const override = overrides[key] as Override<unknown, unknown>;
        const replacement = override(key, env[key], prop);
        Object.defineProperty(globalThis, key, replacement);
      }
    }

    env[cid] = this.#cid;
    for (const key in this.#customGlobals) {
      if (key in globalProps) {
        throw new Error(`Cannot redefine ${key}.`);
      }
      env[key] = this.#customGlobals[key];
    }
  }

  /** Restores the global environment. */
  restore() {
    const env = Object(globalThis);
    if (env[cid] !== this.#cid) {
      throw new Error(
        `Context '${this.#cid}' not active (current: '${env[cid]}').`,
      );
    }

    for (const key in this.#customGlobals) {
      delete env[key];
    }
    delete env[cid];

    for (const key in this.#orig) {
      Object.defineProperty(env, key, this.#orig[key]);
    }
    this.#orig = {};

    for (const timerId of this.#timers) {
      clearInterval(timerId);
    }
    this.#timers.clear();

    this.#abort.abort();
    this.#abort = new AbortController();
  }

  /** Binds a call to fetch to the active invocation. */
  #fetch(fn: typeof fetch, ...[input, init]: Parameters<typeof fetch>) {
    // Create a base request to handle the various ways it can be initialized.
    if (input instanceof URL) {
      input = input.href;
    }
    input = new Request(input, init);

    const record = newFetchRecord(input);

    // Create a customized (re-)initializer, with:
    // - A signal that aborts when the invocation is done.
    // - A custom invocation id header.
    // - A body that logs its size
    init = {
      signal: joinSignals(input.signal, this.#abort.signal),
      headers: { "Yext-Invocation-ID": this.#cid },
      body: input.body?.pipeThrough(
        new TransformStream({
          transform(chunk, ctl) {
            record.sentBytes += chunk.byteLength;
            ctl.enqueue(chunk);
          },
        }),
      ),
    };

    //
    let p = fn(input, init);

    // Turn an abort from an invocation ending into a 408 (Request Timeout) response.
    // This is mostly so that Deno doesn't crash on the unobserved rejection,
    // which is likely what will happen if a fetch ends up leaking.
    const invokeSignal = this.#abort.signal;
    p = p.catch((e) => {
      if (e?.name === "AbortError" && invokeSignal.aborted) {
        return new Response(null, {
          status: 408,
          statusText: "Request aborted.",
        });
      }
      throw e;
    });

    // Log response metadata to the fetch record.
    // Rely on Content-Length for the body size; there seems to be no clean way to replace the body
    // with a logging stream as with the request, and alternatives could require reading the whole
    // thing into memory.
    p = p.then((rsp) => {
      record.status = rsp.status;
      record.statusText = rsp.statusText;
      record.endTime = new Date().toISOString();
      const length = parseInt(rsp.headers.get("Content-Length") ?? "");
      if (!Number.isNaN(length)) {
        record.receivedBytes = length;
      }
      this.#logger.fetch?.(record);
      return rsp;
    });

    return p;
  }

  /** Specifies how to handle each defined global. */
  #globals: {
    [K in keyof typeof globalThis]: Override<K, typeof globalThis[K]>;
  } = {
    // global accessors
    self: allow,
    globalThis: allow,

    // restricted features
    WebAssembly: forbid,
    eval: forbid,
    queueMicrotask: forbid,
    fetch: wrap((...args) => this.#fetch(...args)),
    setTimeout: replace((fn) =>
      (cb, delay, ...args) => {
        const timerId = fn(cb, delay, ...args);
        this.#timers.add(timerId);
        return timerId;
      }
    ),
    setInterval: replace((fn) =>
      (cb, delay, ...args) => {
        const timerId = fn(cb, delay, ...args);
        this.#timers.add(timerId);
        return timerId;
      }
    ),
    clearInterval: replace((fn) =>
      (id) => {
        this.#timers.delete(id!);
        fn(id);
      }
    ),
    clearTimeout: replace((fn) =>
      (id) => {
        this.#timers.delete(id!);
        fn(id);
      }
    ),

    // Worker properties
    name: allow,
    location: allow,
    navigator: forbid,

    // Worker events/life-cycle control
    close: forbid,
    onerror: forbid,
    postMessage: forbid,
    onmessage: forbid,
    onmessageerror: forbid,

    // EventTarget
    addEventListener: forbid,
    removeEventListener: forbid,
    dispatchEvent: forbid,

    // (disabled by permissions anyway)
    Deno: forbid,

    // primitive functions/properties
    parseInt: allow,
    parseFloat: allow,
    isNaN: allow,
    isFinite: allow,
    decodeURI: allow,
    decodeURIComponent: allow,
    encodeURI: allow,
    encodeURIComponent: allow,
    escape: allow,
    unescape: allow,
    atob: allow,
    btoa: allow,
    undefined: allow,
    console: allow,
    performance: allow,
    crypto: allow,
    NaN: allow,
    Infinity: allow,

    // global types
    Symbol: allow,
    Object: allow,
    Function: allow,
    String: allow,
    Number: allow,
    Boolean: allow,
    Math: allow,
    Date: allow,
    RegExp: allow,
    Error: allow,
    EvalError: allow,
    RangeError: allow,
    ReferenceError: allow,
    SyntaxError: allow,
    TypeError: allow,
    URIError: allow,
    JSON: allow,
    Array: allow,
    Promise: allow,
    ArrayBuffer: allow,
    DataView: allow,
    Int8Array: allow,
    Uint8Array: allow,
    Uint8ClampedArray: allow,
    Int16Array: allow,
    Uint16Array: allow,
    Int32Array: allow,
    Uint32Array: allow,
    Float32Array: allow,
    Float64Array: allow,
    Intl: allow,
    Map: allow,
    WeakMap: allow,
    Set: allow,
    WeakSet: allow,
    Proxy: allow,
    Reflect: allow,
    SharedArrayBuffer: allow,
    Atomics: allow,
    BigInt: allow,
    BigInt64Array: allow,
    BigUint64Array: allow,
    AggregateError: allow,
    WeakRef: allow,
    FinalizationRegistry: allow,
    AbortSignal: allow,
    FileReader: allow,
    ReadableStreamDefaultReader: allow,
    ReadableStreamReader: allow,
    ReadableStreamDefaultController: allow,
    ReadableByteStreamController: allow,
    ReadableStream: allow,
    WritableStream: allow,
    WritableStreamDefaultWriter: allow,
    TransformStream: allow,
    BroadcastChannel: allow,
    SubtleCrypto: allow,
    CryptoKey: allow,
    CryptoKeyPair: allow,
  };
}

// Allows a property through unchanged.
function allow<K, T>(_key: K, _val: T, prop: PropertyDescriptor) {
  return prop;
}

// Throws an error when a property is accessed (or called, if a function).
function forbid<K, T>(key: K, val: T) {
  const fail = () => {
    throw new Error(`${key} is not supported`);
  };
  if (val instanceof Function) {
    return { get: () => fail };
  }
  return { get: fail };
}

// Replaces the value of a property.
function replace<K, T>(fn: (val: T) => T): Override<K, T> {
  return (_key, val) => {
    const newVal = fn(val);
    return { get: () => newVal };
  };
}

// Wraps calls to a function.
// deno-lint-ignore no-explicit-any
function wrap<K, T extends (...args: any[]) => any>(
  fn: (fn: T, ...val: Parameters<T>) => ReturnType<T>,
): Override<K, T> {
  return (_key, val) => {
    const newVal = (...args: Parameters<T>) => fn(val, ...args);
    return { get: () => newVal };
  };
}

// Creates an AbortSignal that fires when any of a set of input signals fires.
function joinSignals(...signals: AbortSignal[]) {
  if (signals.length === 0) {
    return new AbortSignal();
  }
  if (signals.length === 1) {
    return signals[0];
  }
  const ctl = new AbortController();
  for (const signal of signals) {
    signal.addEventListener("abort", () => ctl.abort());
    if (signal.aborted) {
      ctl.abort();
    }
  }
  return ctl.signal;
}

// Initializes a FetchRecord for a request.
function newFetchRecord(req: Request): FetchRecord {
  const url = new URL(req.url);
  return {
    scheme: url.protocol.substring(0, url.protocol.length - 1), // trim :
    host: url.hostname,
    method: req.method,
    status: 0,
    statusText: "",
    startTime: new Date().toISOString(),
    endTime: "",
    sentBytes: 0,
    receivedBytes: 0,
  };
}
