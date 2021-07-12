import { parse } from "https://deno.land/std@0.95.0/flags/mod.ts";
import { Server } from "./server/mod.ts";

const args = parse(Deno.args, {
  default: { config: null, port: 8080 },
});

if (args._.length !== 1) {
  console.error(`usage: ${Deno.mainModule} [flags] [module]`);
  Deno.exit(1);
}

const plugin = {
  module: `file://${Deno.cwd()}/${args._[0]}`,
};

if (args.config) {
  const config = JSON.parse(Deno.readTextFileSync(args.config));
  Object.assign(plugin, config);
}

const server = new Server(plugin, args.port);
await server.run();
