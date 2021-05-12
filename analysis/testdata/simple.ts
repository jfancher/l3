/**
 * An example plugin function that formats a number as hexadecimal.
 * 
 * @param n The number
 * @returns The formatted number
 */
export function hex(n: number) {
  return n.toString(16);
}

export function noArgConst() {
  return "value";
}

export function explicitReturn(x: unknown): Record<string, string> {
  internalFunc(String(x));
  return {};
}

function internalFunc(s: string) {
  return s;
}
