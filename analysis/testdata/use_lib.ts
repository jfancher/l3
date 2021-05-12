import { sprintf } from "https://deno.land/std@0.95.0/fmt/printf.ts";

export function hex(n: number) {
  return sprintf("%x", n);
}
