import { analyze } from "./analysis/mod.ts";

if (Deno.args.length !== 1) {
  console.error(`usage: ${Deno.mainModule} [plugin-module]`);
  Deno.exit(1);
}

const meta = analyze(Deno.args[0]);
await Deno.stdout.write(new TextEncoder().encode(JSON.stringify(meta)));
