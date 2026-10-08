import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

test("voice helpers used by client components have no server runtime dependencies", () => {
  const root = process.cwd();
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    baseUrl: root,
    paths: { "@/*": ["src/*"] },
  };
  const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
  const visited = new Set<string>();

  function visit(filename: string): void {
    filename = path.resolve(filename);
    if (visited.has(filename)) return;
    visited.add(filename);
    // Type-only references are deliberately erased, as they are in the client bundle.
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: options,
    }).outputText;
    const source = ts.createSourceFile(filename, output, ts.ScriptTarget.ES2022, true);
    const dependencies: string[] = [];
    function collect(node: ts.Node): void {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        dependencies.push(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0])
      )
        dependencies.push(node.arguments[0].text);
      ts.forEachChild(node, collect);
    }
    collect(source);
    for (const dependency of dependencies) {
      assert.ok(
        dependency !== "server-only" && !builtins.has(dependency.replace(/^node:/, "")),
        path.relative(root, filename) + " imports server dependency " + dependency,
      );
      const resolved = ts.resolveModuleName(dependency, filename, options, ts.sys).resolvedModule;
      assert.ok(resolved, "Unresolved voice dependency: " + dependency);
      if (!resolved.isExternalLibraryImport) visit(resolved.resolvedFileName);
    }
  }

  visit(path.join(root, "src/lib/higgsfield/voice.ts"));
  assert.ok(visited.has(path.resolve(root, "src/lib/voice/contract.ts")));
});
