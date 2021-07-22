import { delay } from "https://deno.land/std@0.95.0/async/mod.ts";
import * as log from "https://deno.land/std@0.95.0/log/mod.ts";

export function fn(arg: { name: string }): { message: string } {
  log.info("called fn");
  log.debug(arg);
  return { message: `name: ${arg.name}` };
}

export async function afn(s: string) {
  return await Promise.resolve(`afn: ${s}`);
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

export async function doFetch(url: string) {
  // fetch(string)
  const strResponse = await fetch(`${url}?string`);
  let strResult = strResponse.statusText;
  if (strResponse.ok) {
    strResult = await strResponse.json();
  }

  // fetch(URL)
  const urlResponse = await fetch(new URL(`${url}?url`));
  let urlResult = urlResponse.statusText;
  if (urlResponse.ok) {
    urlResult = await urlResponse.json();
  }

  // fetch(Request)
  const reqResponse = await fetch(new Request(url, { method: "CUSTOM" }));
  let reqResult = reqResponse.statusText;
  if (reqResponse.ok) {
    reqResult = await reqResponse.json();
  }

  return [strResult, urlResult, reqResult];
}

export async function fetchAbort(arg: { url: string; abort: boolean }) {
  const ctl = new AbortController();
  if (arg.abort) {
    ctl.abort();
  }
  const res = await fetch(new Request(arg.url, { signal: ctl.signal }));
  return await res.json();
}

let leakResult = "No value.";
export function doFetchLeak(url?: string) {
  if (url) {
    // not awaited, should be aborted upon return
    fetch(url).then((r) => leakResult = r.statusText);
  }
  return leakResult;
}

declare const MY_KEY: number;
export function useGlobal(arg: string) {
  return `${arg}: ${MY_KEY}`;
}

let concurCalls = 0;
export async function concur() {
  concurCalls++;
  await delay(50);
  return concurCalls;
}
