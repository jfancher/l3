import { parse } from "https://deno.land/std@0.95.0/flags/mod.ts";
import { Application, Router } from "https://deno.land/x/oak@v7.3.0/mod.ts";

const args = parse(Deno.args, {
  default: { port: 8080 },
});

if (args._.length !== 1) {
  console.error(`usage: ${Deno.mainModule} [flags] <plugin-module>`);
  Deno.exit(1);
}

const plugin = await import(args._[0] as string);

const router = new Router();
router.get("/ready", (ctx) => {
  ctx.response.body = "ok";
});

router.post("/invoke/:func", async (ctx) => {
  const body = ctx.request.body({ type: "json" });
  const payload: Record<string, unknown> = await body.value;
  const result = plugin[ctx.params?.func ?? "TODO_error"](payload);
  ctx.response.type = "application/json";
  ctx.response.body = result;
});

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());

await app.listen({ port: args.port });
