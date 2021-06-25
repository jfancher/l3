/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

// Set on the global object to indicate the current call id.
const cid = Symbol("cid");

// Overrides a global property.
type Override<K, T> = (
  cid: string,
  key: K,
  value: T,
  prop: PropertyDescriptor,
) => PropertyDescriptor;

/** Creates a restricted execution environment for a plugin invocation. */
export class InvocationContext {
  #cid: string;
  #orig: Record<PropertyKey, PropertyDescriptor>;
  #timers: Set<number>;

  /**
   * Initializes a new invocation context.
   *
   * @param cid The call id
   */
  constructor(cid: string) {
    this.#cid = cid;
    this.#orig = {};
    this.#timers = new Set();
  }

  /** Sets the global environment to the isolated invocation context. */
  enter() {
    const env = Object(globalThis);
    if (env[cid]) {
      throw new Error(
        `cannot reenter context '${this.#cid}' (current: ${env[cid]})`,
      );
    }

    const globalProps = Object.getOwnPropertyDescriptors(env);
    const overrides = Object(this.#globals);
    for (const key in globalProps) {
      const prop = globalProps[key];
      this.#orig[key] = prop;
      if (key in overrides) {
        const override = overrides[key] as Override<unknown, unknown>;
        const replacement = override(this.#cid, key, env[key], prop);
        Object.defineProperty(globalThis, key, replacement);
      }
    }

    env[cid] = this.#cid;
  }

  /** Restores the global environment. */
  exit() {
    const env = Object(globalThis);
    if (env[cid] !== this.#cid) {
      throw new Error(
        `context '${this.#cid}' not active (current: '${env[cid]}')`,
      );
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
    fetch: forbid,
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
  };
}

// Allows a property through unchanged.
function allow<K, T>(_cid: string, _key: K, _val: T, prop: PropertyDescriptor) {
  return prop;
}

// Throws an error when a property is accessed (or called, if a function).
function forbid<K, T>(_: string, key: K, val: T) {
  const fail = () => {
    throw new Error(`${key} is not supported`);
  };
  if (val instanceof Function) {
    return { get: () => fail };
  }
  return { get: fail };
}

// Replaces the value of a property.
function replace<K, T>(fn: (val: T, cid: string) => T): Override<K, T> {
  return (cid, _key, val) => {
    const newVal = fn(val, cid);
    return { get: () => newVal };
  };
}
