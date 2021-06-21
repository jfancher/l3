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

Deno.test("worker > invoke concurrent", async () => {
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
});

Deno.test("worker > abort", async () => {
  const host = new PluginHost();
  await host.load("./testdata/test_plugin.ts");
  const invoke = host.invoke("spin", null);
  host.terminate();
  await assertThrowsAsync(() => invoke);
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
