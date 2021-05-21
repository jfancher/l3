import { Timeout } from "https://deno.land/x/timeout@2.4/mod.ts";
import * as path from "https://deno.land/std@0.95.0/path/mod.ts";
import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.95.0/testing/asserts.ts";
import { getAvailablePort } from "https://deno.land/x/port@1.0.0/mod.ts";
import { Server } from "./server.ts";
import { InvokeResponse } from "./response.ts";

invokeTest(
  "server > invoke success",
  "simple_plugin.ts",
  async (host: string) => {
    const response = await fetch(`${host}/invoke/up`, {
      method: "POST",
      body: JSON.stringify("str"),
    });

    const body: InvokeResponse = await response.json();
    assertMatch(body.module, /simple_plugin.ts$/);
    assertEquals(body.functionName, "up");
    assertEquals(body.status, "OK");
    assertEquals(body.result, "STR");
    assertEquals(body.error, undefined);
    assertEquals(response.status, 200);
  },
);

invokeTest(
  "server > invoke error",
  "simple_plugin.ts",
  async (host: string) => {
    const response = await fetch(`${host}/invoke/up`, {
      method: "POST",
      body: JSON.stringify({ "unexpected": "type" }),
    });

    const body: InvokeResponse = await response.json();
    assertMatch(body.module, /simple_plugin.ts$/);
    assertEquals(body.functionName, "up");
    assertEquals(body.status, "RuntimeError", JSON.stringify(body));
    assertEquals(body.result, undefined);
    assertEquals(body.error?.name, "TypeError");
    assertEquals(body.error?.message, "s.toUpperCase is not a function");
    assertMatch(
      body.error?.stack ?? "",
      /TypeError: s\.toUpperCase is not a function.*/,
    );
    assertEquals(response.status, 500);
  },
);

function invokeTest(
  name: string,
  mod: string,
  fn: (host: string, srv: Server) => Promise<void>,
) {
  Deno.test(name, async () => {
    const dir = path.dirname(new URL(import.meta.url).pathname);
    const port = await getAvailablePort();
    const srv = new Server(path.join(dir, "testdata", mod), port);
    const stopped = srv.run();

    const host = `http://localhost:${port}`;
    try {
      await Timeout.race([srv.ensureLoaded()], 1000);
      await Timeout.race([fn(host, srv)], 1000);
    } finally {
      srv.stop();
      await Timeout.race([stopped], 1000);
    }
  });
}
