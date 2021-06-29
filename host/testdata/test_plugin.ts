import { deferred, delay } from "https://deno.land/std@0.95.0/async/mod.ts";
import * as log from "https://deno.land/std@0.95.0/log/mod.ts";

export function fn(arg: { name: string }): { message: string } {
  log.info("called fn");
  log.debug(arg);
  return { message: `name: ${arg.name}` };
}

export async function afn(s: string) {
  return await Promise.resolve(`afn: ${s}`);
}

const concurDone = deferred<string>();
export async function concur(val: string | null) {
  if (val) {
    concurDone.resolve(val);
  }
  return await concurDone;
}

export function spin() {
  for (let a = 0; a < Number.MAX_SAFE_INTEGER; a++);
}

export async function wait(n: number) {
  await delay(n);
  return n;
}

export function doEval(s: string) {
  return eval(s); // throws as access is restricted
}

let leakCounter = 0;
export async function leakAsync() {
  await delay(2);
  delay(1).then(() => leakCounter++); // should never finish
  return leakCounter;
}
