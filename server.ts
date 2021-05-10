import { parse } from "https://deno.land/std@0.95.0/flags/mod.ts";
import {
  Application,
  httpErrors,
  Router,
} from "https://deno.land/x/oak@v7.3.0/mod.ts";
import { PluginHost } from "./host/mod.ts";

const args = parse(Deno.args, {
  default: { port: 8080 },
});

if (args._.length !== 0) {
  console.error(`usage: ${Deno.mainModule} [flags]`);
  Deno.exit(1);
}

const plugins: Map<string, PluginHost> = new Map();

const router = new Router();

// GET /ready
//
// Verifies the server is running.
router.get("/ready", (ctx) => {
  ctx.response.body = "ok";
});

// POST /invoke/:plugin/:func
//
// Invokes a plugin function. First load the plugin located at `./:plugin/mod.ts` if needed, then
// calls the named function, providing the posted body as an argument.
router.post("/invoke/:plugin/:func", async (ctx) => {
  const [name, func] = [ctx.params?.plugin, ctx.params?.func];
  if (!name || !func) {
    throw new httpErrors.BadRequest(
      "missing required 'plugin' or 'function' parameter",
    );
  }

  let host = plugins.get(name);
  if (!host) {
    host = new PluginHost();
    await host.load(`${Deno.cwd()}/${name}/mod.ts`);
    plugins.set(name, host);
  }

  const body = ctx.request.body({ type: "json" });
  const arg: unknown = await body.value;
  const result = await host.invoke(func, arg);
  ctx.response.type = "application/json";
  ctx.response.body = JSON.stringify(result);
});

const app = new Application();
// TODO: distinguish internal vs plugin errors
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (e) {
    console.log(`${ctx.request.method} ${ctx.request.url}\n`, e);
    ctx.throw(500, Deno.inspect(e));
  }
});
app.use(router.routes());
app.use(router.allowedMethods());

await app.listen({ port: args.port });
