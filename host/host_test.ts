import {
  assertEquals,
  assertThrowsAsync,
} from "https://deno.land/std@0.95.0/testing/asserts.ts";
import { serve } from "https://deno.land/std@0.95.0/http/server.ts";
import { PluginHost } from "./host.ts";

Deno.test("worker > invoke success", async () => {
  const host = new PluginHost();
  await host.load("./testdata/test_plugin.ts");
  const result = await host.invoke("fn", { name: "test" });
  assertEquals(result.value, { message: "name: test" });
  assertEquals(result.logs, [
    { level: "INFO", loggerName: "default", "message": "called fn" },
    { level: "DEBUG", loggerName: "default", "message": `{"name":"test"}` },
  ]);
  host.terminate();
});

Deno.test("worker > invoke async", async () => {
  const host = new PluginHost();
  await host.load("./testdata/test_plugin.ts");
  const result = await host.invoke("afn", "str");

  assertEquals(result.value, "afn: str");
  host.terminate();
});

Deno.test({
  name: "worker > invoke concurrent",
  ignore: true, // reverted to serial; logging at least needs more work
  fn: async () => {
    const host = new PluginHost();
    await host.load("./testdata/test_plugin.ts");

    const first = host.invoke("concur", null);
    const second = host.invoke("concur", "done");
    assertEquals((await first).value, "done");
    assertEquals((await second).value, "done");
    host.terminate();
  },
});

Deno.test("worker > terminate", async () => {
  const host = new PluginHost();
  await host.load("./testdata/test_plugin.ts");
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
  const host = new PluginHost();
  await host.load("./testdata/test_plugin.ts");
  const invoke = host.invoke("wait", 50);
  const shutdown = host.shutdown();
  await assertThrowsAsync(() => host.invoke("wait", 50)); // closed to new requests
  await shutdown;
  await assertThrowsAsync(() => host.invoke("wait", 50)); // terminated
  const result = await invoke;
  assertEquals(result.value, 50);
});

Deno.test("worker > abort", async () => {
  const host = new PluginHost();
  await host.load("./testdata/test_plugin.ts");

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
  const host = new PluginHost();
  await host.load("./testdata/test_plugin.ts");

  const result = await host.invoke("doEval", "1");
  assertEquals(result.value, undefined);
  assertEquals(result.error?.message, "eval is not supported");
  host.terminate();
});

Deno.test("worker > wrap schedule", async () => {
  const host = new PluginHost();
  await host.load("./testdata/test_plugin.ts");

  const result1 = await host.invoke("leakAsync", "{}");
  assertEquals(result1.value, 0);

  const result2 = await host.invoke("leakAsync", "{}");
  assertEquals(result2.value, 0);
  host.terminate();
});

Deno.test("worker > wrap fetch", async () => {
  const host = new PluginHost();
  await host.load("./testdata/test_plugin.ts");

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
