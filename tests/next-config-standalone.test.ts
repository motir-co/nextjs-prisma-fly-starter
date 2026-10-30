// MOTIR-5778: the image the preview workflow pushes is the Dockerfile's, which
// copies `.next/standalone` into its runtime stage. Without
// `output: 'standalone'` that directory is never written and the image build
// fails — or, worse, a later Dockerfile change works around it with a full
// `node_modules`. Asserted over the TypeScript AST so a comment or a string
// elsewhere in the file cannot satisfy it.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const CONFIG_PATH = path.join(process.cwd(), 'next.config.ts');

/** The literal value of `output` on the config object the file default-exports. */
function exportedOutput(source: string): string | null {
  const file = ts.createSourceFile('next.config.ts', source, ts.ScriptTarget.Latest, true);
  const objects = new Map<string, ts.ObjectLiteralExpression>();
  let exported: ts.Expression | undefined;

  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          const init = ts.isSatisfiesExpression(decl.initializer)
            ? decl.initializer.expression
            : decl.initializer;
          if (ts.isObjectLiteralExpression(init)) objects.set(decl.name.text, init);
        }
      }
    }
    if (ts.isExportAssignment(statement)) exported = statement.expression;
  }

  // `export default withPlugin(nextConfig)` or `export default nextConfig`.
  const target = exported && ts.isCallExpression(exported) ? exported.arguments[0] : exported;
  const config =
    target && ts.isIdentifier(target)
      ? objects.get(target.text)
      : target && ts.isObjectLiteralExpression(target)
        ? target
        : undefined;
  if (!config) return null;

  for (const prop of config.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'output' &&
      ts.isStringLiteralLike(prop.initializer)
    ) {
      return prop.initializer.text;
    }
  }
  return null;
}

describe('next.config.ts builds the standalone server the image runs', () => {
  const source = fs.readFileSync(CONFIG_PATH, 'utf8');

  it("the default-exported config sets output: 'standalone'", () => {
    expect(exportedOutput(source)).toBe('standalone');
  });

  it('the Dockerfile copies the standalone output it depends on', () => {
    const dockerfile = fs.readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(/COPY --from=build .*\/app\/\.next\/standalone \.\//);
  });

  it('a check that would catch the option removed, or only mentioned in a comment', () => {
    const removed = source.replace(/^\s*output: 'standalone',\n/m, "  // output: 'standalone',\n");
    expect(removed).not.toBe(source);
    expect(exportedOutput(removed)).toBeNull();
  });

  it('reads an inline exported object and a satisfies-typed config the same way', () => {
    expect(exportedOutput("export default { output: 'standalone' };")).toBe('standalone');
    expect(
      exportedOutput("const c = { output: 'export' } satisfies object;\nexport default wrap(c);"),
    ).toBe('export');
    expect(exportedOutput('export default wrap(somethingElse);')).toBeNull();
  });
});
