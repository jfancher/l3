import {
  assertEquals,
  assertThrowsAsync,
} from "https://deno.land/std@0.95.0/testing/asserts.ts";
import { serve } from "https://deno.land/std@0.95.0/http/server.ts";
import { PluginHost } from "./host.ts";
import { delay } from "https://deno.land/std@0.95.0/async/mod.ts";

Deno.test("worker > invoke success", async () => {
  const host = new PluginHost({ module: "./testdata/test_plugin.ts" });
  await host.ensureLoaded();
  const result = await host.invoke("fn", { name: "test" });
  assertEquals(result.value, { message: "name: test" });
  assertEquals(result.logs, [
    { level: "INFO", loggerName: "default", "message": "called fn" },
    { level: "DEBUG", loggerName: "default", "message": `{"name":"test"}` },
  ]);
  host.terminate();
});

Deno.test("worker > invoke async", async () => {
  const host = new PluginHost({ module: "./testdata/test_plugin.ts" });
  await host.ensureLoaded();
  const result = await host.invoke("afn", "str");

  assertEquals(result.value, "afn: str");
  host.terminate();
});

Deno.test("worker > terminate", async () => {
  const host = new PluginHost({ module: "./testdata/test_plugin.ts" });
  await host.ensureLoaded();
  const invoke = host.invoke("spin", null);
  host.terminate();
  const result = await invoke;
  assertEquals(result.value, undefined);
  assertEquals(result.error, {
    name: "TerminateError",
    message: "Worker was terminated",
  });
});

Deno.test("worker > shutdown", async () => {
  const host = new PluginHost({ module: "./testdata/test_plugin.ts" });
  await host.ensureLoaded();
  const invoke = host.invoke("wait", 50);
  const shutdown = host.shutdown();
  await assertThrowsAsync(() => host.invoke("wait", 50)); // closed to new requests
  await shutdown;
  await assertThrowsAsync(() => host.invoke("wait", 50)); // terminated
  const result = await invoke;
  assertEquals(result.value, 50);
});

Deno.test("worker > abort", async () => {
  const host = new PluginHost({ module: "./testdata/test_plugin.ts" });
  await host.ensureLoaded();

  const ctl = new AbortController();
  const invoke = host.invoke("spin", null, { signal: ctl.signal });
  ctl.abort();

  const result = await invoke;
  assertEquals(result.value, undefined);
  assertEquals(result.error, {
    name: "AbortError",
    message: "Invocation was aborted",
  });
  host.terminate();
});

Deno.test("worker > restricted", async () => {
  const host = new PluginHost({ module: "./testdata/test_plugin.ts" });
  await host.ensureLoaded();

  const result = await host.invoke("doEval", "1");
  assertEquals(result.value, undefined);
  assertEquals(result.error?.message, "eval is not supported");
  host.terminate();
});

Deno.test("worker > wrap schedule", async () => {
  const host = new PluginHost({ module: "./testdata/test_plugin.ts" });
  await host.ensureLoaded();

  const result1 = await host.invoke("leakAsync", "{}");
  assertEquals(result1.value, 0);

  const result2 = await host.invoke("leakAsync", "{}");
  assertEquals(result2.value, 0);
  host.terminate();
});

Deno.test("worker > wrap fetch", async () => {
  const host = new PluginHost({ module: "./testdata/test_plugin.ts" });
  await host.ensureLoaded();

  const srv = serve({ port: 0 });
  const port = (srv.listener.addr as Deno.NetAddr).port;
  (async () => {
    for await (const req of srv) {
      req.respond({ body: `"${req.method} ${req.url}"` });
    }
  })();

  const url = `http://localhost:${port}/test`;

  // normal fetch
  const result1 = await host.invoke("doFetch", url);
  assertEquals(result1.value, [
    "GET /test?string",
    "GET /test?url",
    "CUSTOM /test",
  ]);

  // fetch with explicit abort
  const result2 = await host.invoke("fetchAbort", { url, abort: true });
  assertEquals(result2.value, undefined);
  assertEquals(result2.error?.message, "Ongoing fetch was aborted.");

  const result3 = await host.invoke("fetchAbort", { url, abort: false });
  assertEquals(result3.value, "GET /test");

  // leak a fetch, ensure it's aborted
  const result4 = await host.invoke("doFetchLeak", url);
  assertEquals(result4.value, "No value.");
  const result5 = await host.invoke("doFetchLeak", undefined);
  assertEquals(result5.value, "Request aborted.");

  srv.close();
  host.terminate();
});

Deno.test("worker > global", async () => {
  const host = new PluginHost({
    module: "./testdata/test_plugin.ts",
    globals: { "MY_KEY": 12345 },
  });
  await host.ensureLoaded();

  const result = await host.invoke("useGlobal", "test");
  assertEquals(result.value, "test: 12345");

  host.terminate();
});

Deno.test("worker > concurrent", async () => {
  const host = new PluginHost({
    module: "./testdata/test_plugin.ts",
    concurrency: 2,
  });

  // wait for 2 workers; ensureLoaded() only waits for 1
  let loadTime = 0;
  while (loadTime < 30_000 && host.status.workers < 2) {
    await delay(100);
    loadTime += 100;
  }
  assertEquals(host.status.workers, 2);

  // double-check that the two are loaded in different workers
  const one = host.invoke("concur", null);
  const two = host.invoke("concur", null);
  assertEquals((await one).value, 1);
  assertEquals((await two).value, 1);

  // schedule a few more; they should cycle between workers
  const three = host.invoke("concur", null);
  const four = host.invoke("concur", null);
  const five = host.invoke("concur", null);
  const six = host.invoke("concur", null);
  assertEquals((await three).value, 2);
  assertEquals((await four).value, 2);
  assertEquals((await five).value, 3);
  assertEquals((await six).value, 3);

  host.terminate();
});

Deno.test("worker > reload", async () => {
  const host = new PluginHost({ module: "./testdata/test_plugin.ts" });
  await host.ensureLoaded();

  const ctl = new AbortController();
  const first = host.invoke("spin", null, { signal: ctl.signal });
  const second = host.invoke("afn", "x");

  // first should be aborted, but second should still complete
  ctl.abort();
  const result1 = await first;
  assertEquals(result1.value, undefined);
  assertEquals(result1.error, {
    name: "AbortError",
    message: "Invocation was aborted",
  });
  const result2 = await second;
  assertEquals(result2.value, "afn: x");

  host.terminate();
});
