import {
  assertEquals,
  assertThrowsAsync,
} from "https://deno.land/std@0.95.0/testing/asserts.ts";
import { PluginHost } from "./host.ts";

Deno.test("worker > invoke success", async () => {
  const host = new PluginHost();
  await host.load("./testdata/test_plugin.ts");
  const result = await host.invoke("fn", { name: "test" });
  assertEquals(result, {
    value: { message: "name: test" },
    logs: [
      { level: "INFO", loggerName: "default", "message": "called fn" },
      { level: "DEBUG", loggerName: "default", "message": `{"name":"test"}` },
    ],
  });
  host.terminate();
});

Deno.test("worker > invoke async", async () => {
  const host = new PluginHost();
  await host.load("./testdata/test_plugin.ts");
  const result = await host.invoke("afn", "str");
  assertEquals(result, {
    value: "afn: str",
    logs: [],
  });
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
    assertEquals(await first, {
      value: "done",
      logs: [],
    });
    assertEquals(await second, {
      value: "done",
      logs: [],
    });
    host.terminate();
  },
});

Deno.test("worker > terminate", async () => {
  const host = new PluginHost();
  await host.load("./testdata/test_plugin.ts");
  const invoke = host.invoke("spin", null);
  host.terminate();
  assertEquals(await invoke, {
    value: undefined,
    logs: [],
    error: {
      name: "TerminateError",
      message: "Worker was terminated",
    },
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
  assertEquals(await invoke, {
    value: 50,
    logs: [],
  });
});

Deno.test("worker > abort", async () => {
  const host = new PluginHost();
  await host.load("./testdata/test_plugin.ts");

  const ctl = new AbortController();
  const invoke = host.invoke("spin", null, { signal: ctl.signal });
  ctl.abort();
  assertEquals(await invoke, {
    value: undefined,
    logs: [],
    error: {
      name: "AbortError",
      message: "Invocation was aborted",
    },
  });
  host.terminate();
});
