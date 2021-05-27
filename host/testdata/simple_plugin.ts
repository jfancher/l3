import * as log from "https://deno.land/std@0.95.0/log/mod.ts";

export function fn(arg: { name: string }): { message: string } {
  log.info("called fn");
  log.debug(arg);
  return { message: `name: ${arg.name}` };
}
