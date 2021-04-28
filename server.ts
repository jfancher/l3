import { Call } from "./plugin.ts";
import { Application, Router } from "https://deno.land/x/oak@v7.3.0/mod.ts";

const args = Deno.args;
if (args.length === 0 || args.length > 1) {
  console.error(`usage: ${Deno.mainModule} [plugin-module]`);
  Deno.exit(1);
}

const plugin = await import(args[0]);

const router = new Router();
router.post("/invoke", async (ctx) => {
  const body = ctx.request.body({ type: "json" });
  const call: Call = await body.value;
  const result = plugin[call.function](call.payload);
  ctx.response.type = "application/json";
  ctx.response.body = result;
});

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());

await app.listen({ port: 8080 });
