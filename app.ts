import { parse } from "https://deno.land/std@0.95.0/flags/mod.ts";
import { Server } from "./server/mod.ts";

const args = parse(Deno.args, {
  default: { port: 8080 },
});

if (args._.length !== 1) {
  console.error(`usage: ${Deno.mainModule} [flags] [module]`);
  Deno.exit(1);
}

const mod = `file://${Deno.cwd()}/${args._[0]}`;
const server = new Server(mod, args.port);
await server.run();
