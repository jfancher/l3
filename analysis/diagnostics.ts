import { ts } from "https://deno.land/x/ts_morph@10.0.2/mod.ts";

/**
 * Converts a Typescript diagnostic to a Deno diagnostic.
 * 
 * @remarks
 * This gives us the freedom to switch to `Deno.emit` if we run into compatibility problems between
 * Deno and the full Typescript compiler. The Deno model is also simpler to serialize.
 * 
 * @param diag The Typescript diagnostic
 * @returns The Deno diagnostic
 */
export function convertDiagnostic(diag: ts.Diagnostic): Deno.Diagnostic {
  const result: Deno.Diagnostic = {
    code: diag.code,
    category: diag.category,
  };

  if (typeof diag.messageText === "string") {
    result.messageText = diag.messageText;
  }

  // TODO: other properties

  return result;
}
