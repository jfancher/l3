import { assertEquals } from "https://deno.land/std@0.95.0/testing/asserts.ts";
import { PluginHost } from "./host.ts";

Deno.test("invoke success", async () => {
  const host = new PluginHost();
  await host.load("./testdata/simple_plugin.ts");
  const result = await host.invoke("fn", { name: "test" });
  assertEquals(result, { message: "name: test" });
  host.close();
});
