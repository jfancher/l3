import { assertEquals } from "https://deno.land/std@0.95.0/testing/asserts.ts";
import * as path from "https://deno.land/std@0.95.0/path/mod.ts";
import { analyze, PluginMetadata } from "./analysis.ts";

// simple.ts: a few basic functions with no dependencies.
analyzeTest("simple.ts", {
  functions: [{
    name: "hex",
    documentation:
      `An example plugin function that formats a number as hexadecimal.

@param n The number
@returns The formatted number`,
    parameterType: "number",
    returnType: "string",
  }, {
    name: "noArgConst",
    returnType: "string",
  }, {
    name: "explicitReturn",
    parameterType: "unknown",
    returnType: "Record<string, string>",
  }],
});

// reexport.ts: functions from simple.ts imported and re-exported.
analyzeTest("reexport.ts", {
  functions: [{
    name: "hex",
    documentation:
      `An example plugin function that formats a number as hexadecimal.

@param n The number
@returns The formatted number`,
    parameterType: "number",
    returnType: "string",
  }, {
    name: "newName",
    parameterType: "unknown",
    returnType: "Record<string, string>",
  }],
});

// use_lib.ts: function type depends on an external library.
// TODO: library imports are not yet working.
analyzeTest("use_lib.ts", {
  ignore: true,
  functions: [{
    name: "hex",
    parameterType: "number",
    returnType: "string",
  }],
});

// invalid_type.ts: diagnostics for type errors.
analyzeTest("invalid_type.ts", {
  diagnostics: [{
    category: 1,
    code: 2304,
    messageText: "Cannot find name 'NoSuchType'.",
  }],
  functions: [{
    name: "unknownName",
    parameterType: "string",
    returnType: "any",
  }],
});

type TestCase = Partial<PluginMetadata & { ignore: boolean }>;

function analyzeTest(name: string, testCase: TestCase) {
  Deno.test({
    name: `analyze ${name}`,
    ignore: testCase.ignore,
    fn: () => {
      const dir = path.dirname(new URL(import.meta.url).pathname);
      const actual = analyze(path.join(dir, "testdata", name));
      assertEquals(actual.diagnostics, testCase.diagnostics ?? []);
      assertEquals(actual.functions, testCase.functions ?? []);
    },
  });
}
