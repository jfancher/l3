import { assertEquals } from "https://deno.land/std@0.95.0/testing/asserts.ts";
import { PluginHost } from "./host.ts";

Deno.test("worker > invoke success", async () => {
  const host = new PluginHost();
  await host.load("./testdata/simple_plugin.ts");
  const result = await host.invoke("fn", { name: "test" });
  assertEquals(result, {
    value: { message: "name: test" },
    logs: [
      { level: "INFO", loggerName: "default", "message": "called fn" },
      { level: "DEBUG", loggerName: "default", "message": `{"name":"test"}` },
    ],
  });
  host.close();
});

Deno.test("worker > invoke async", async () => {
  const host = new PluginHost();
  await host.load("./testdata/simple_plugin.ts");
  const result = await host.invoke("afn", "str");
  assertEquals(result, {
    value: "afn: str",
    logs: [],
  });
  host.close();
});
