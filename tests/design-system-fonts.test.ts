import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every `--font-*-source` the INSTALLED @motir/design-system stylesheet reads
// must be defined by app/layout.tsx on <html>. Each `[data-type]` block points
// a role at its face through one of these variables with no in-variable
// fallback, so an unloaded face is not an error: the pairing silently renders
// in a system face. Both sides are derived here, and no list of expected names
// is kept beyond the four-name floor that stops either side passing empty.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(resolve(repoRoot, rel), 'utf8');
const require = createRequire(import.meta.url);

describe('app/layout.tsx loads every face the installed type axis reads', () => {
  const layout = read('app/layout.tsx');

  // tests/design-system-wiring.test.ts names three variables as substrings, so
  // it cannot notice a face the package ADDS. This one derives BOTH sides: what the
  // INSTALLED theme.css reads, and what this layout actually applies. A source
  // the stylesheet reads and nothing defines resolves to the fallback chain, a
  // type axis that looks wired and does nothing — so the next publish that adds
  // a pairing turns this red until its face is loaded here, the same event that
  // turns tests/design-system-version.test.ts red.
  it('defines every `--font-*-source` the installed theme.css reads, on <html>', () => {
    const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');
    const sourceNames = (text: string) => new Set(text.match(/--font-[a-z0-9-]+-source\b/g) ?? []);

    const theme = readFileSync(require.resolve('@motir/design-system/theme.css'), 'utf8');
    const referenced = sourceNames(stripComments(theme));

    // Loader bindings: `const <id> = <Family>({ … variable: '--font-…-source' … })`,
    // matched over the whole file so prettier moving an option to another line
    // cannot shorten the answer.
    const code = layout.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const loaders = new Map<string, { variable: string; options: string }>();
    for (const [, id = '', options = ''] of code.matchAll(
      /const (\w+) = \w+\(\{([\s\S]*?)\}\);/g,
    )) {
      const variable = /variable:\s*'(--font-[a-z0-9-]+-source)'/.exec(options)?.[1];
      if (variable) loaders.set(id, { variable, options });
    }

    // …and only those whose class reaches the <html> element's class list.
    const htmlClass = /<html[\s\S]*?className=\{`([^`]*)`\}/.exec(code)?.[1] ?? '';
    const onHtml = new Set([...htmlClass.matchAll(/\$\{(\w+)\.variable\}/g)].map((m) => m[1]));
    const applied = new Set(
      [...loaders].filter(([id]) => onHtml.has(id)).map(([, { variable }]) => variable),
    );

    const missing = [...referenced].filter((name) => !applied.has(name));
    expect(
      missing,
      `theme.css reads ${missing.join(', ')} but app/layout.tsx defines none`,
    ).toEqual([]);

    // Neither side may be empty: the four pairing faces of 0.22.0 are on both.
    for (const name of [
      '--font-marker-source',
      '--font-rounded-source',
      '--font-slab-source',
      '--font-humanist-source',
    ]) {
      expect(referenced.has(name), `theme.css should read ${name}`).toBe(true);
      expect(applied.has(name), `app/layout.tsx should apply ${name}`).toBe(true);
    }

    // A pairing face is fetched when its pairing is chosen, never on first paint.
    for (const { variable, options } of loaders.values()) {
      expect(options, `${variable} must not preload`).not.toMatch(/preload:\s*true/);
      if (
        [
          '--font-marker-source',
          '--font-rounded-source',
          '--font-slab-source',
          '--font-humanist-source',
        ].includes(variable)
      ) {
        expect(options, `${variable} passes preload: false`).toMatch(/preload:\s*false/);
      }
    }
  });
});
