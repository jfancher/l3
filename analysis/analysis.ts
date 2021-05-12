import {
  FunctionDeclaration,
  Project,
  ResolutionHosts,
  ts,
} from "https://deno.land/x/ts_morph@10.0.2/mod.ts";
import { convertDiagnostic } from "./diagnostics.ts";

/** Analyzed metadata about a plugin. */
export interface PluginMetadata {
  functions: FunctionDescriptor[];
  diagnostics: Deno.Diagnostic[];
}

/** Describes an exported plugin function. */
export interface FunctionDescriptor {
  name: string;
  documentation?: string;
  parameterType?: string;
  returnType?: string;
}

/**
 * Analyzes a plugin module.
 * 
 * @param path The plugin module
 */
export function analyze(path: string): PluginMetadata {
  const diagnostics: Deno.Diagnostic[] = [];
  const functions: FunctionDescriptor[] = [];

  const prj = new Project({
    // TODO: this doesn't seem to resolve remote modules correctly
    resolutionHost: ResolutionHosts.deno,
  });

  const pluginRoot = prj.addSourceFileAtPath(path);
  prj.resolveSourceFileDependencies();

  for (const tsdiag of prj.getPreEmitDiagnostics()) {
    diagnostics.push(convertDiagnostic(tsdiag.compilerObject));
  }

  const exports = pluginRoot.getExportedDeclarations();
  for (const [name, [decl, ...duplicates]] of exports) {
    if (duplicates.length) {
      // TODO: duplicate symbol error? When does this happen?
      continue;
    }

    if (!(decl instanceof FunctionDeclaration)) {
      // TODO: warn/error or just skip for a non-function export?
      continue;
    }

    functions.push(describeFunction(name, decl as FunctionDeclaration));
  }

  return { diagnostics, functions };
}

function describeFunction(name: string, decl: FunctionDeclaration) {
  const fn: FunctionDescriptor = { name };

  const docs = decl.getJsDocs();
  if (docs.length) {
    fn.documentation = docs[docs.length - 1].getInnerText();
  }

  const flags = ts.TypeFormatFlags.NoTruncation |
    ts.TypeFormatFlags.UseFullyQualifiedType |
    ts.TypeFormatFlags.UseStructuralFallback |
    ts.TypeFormatFlags.WriteClassExpressionAsTypeLiteral;

  const params = decl.getParameters();
  if (params.length >= 1) {
    // TODO: error for >1 param?
    const paramType = params[0].getType();
    fn.parameterType = paramType.getText(decl, flags);
  }

  const returnType = decl.getReturnType();
  fn.returnType = returnType.getText(decl, flags);

  return fn;
}
