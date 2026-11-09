import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildThemeInitScript,
  DEFAULT_PALETTE_ID,
  DEFAULT_STYLE_ID,
  DEFAULT_TYPE_ID,
  isPaletteId,
  isStyleId,
  isTypeId,
  resolveAxesToApplied,
  STYLE_DEFAULT_TYPE,
} from '@motir/design-system';

// This starter imports the entire design system from the published
// `@motir/design-system` package — there is no hand-copied token CSS or
// primitive source in the repo (the "two design systems" drift, notes.html
// #18). These tests pin the WIRING that makes that true: the package resolves
// and applies, the token CSS is imported (not vendored), and the layout sets
// the DEFAULT design on <html> through the package's apply seam.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(resolve(repoRoot, rel), 'utf8');
const require = createRequire(import.meta.url);

describe('@motir/design-system is installed and its apply API resolves', () => {
  it('resolves the registry DEFAULT design from empty axes', () => {
    const applied = resolveAxesToApplied({});
    expect(applied.styleId).toBe(DEFAULT_STYLE_ID);
    expect(applied.paletteId).toBe(DEFAULT_PALETTE_ID);
    // The default type follows the default style's pairing (unpinned).
    expect(applied.typeId).toBe(STYLE_DEFAULT_TYPE[DEFAULT_STYLE_ID] ?? DEFAULT_TYPE_ID);
    expect(applied.typePinned).toBe(false);
    // Every applied id is a valid registry id (the closed-enum apply contract).
    expect(isStyleId(applied.styleId)).toBe(true);
    expect(isPaletteId(applied.paletteId)).toBe(true);
    expect(isTypeId(applied.typeId)).toBe(true);
  });

  it('builds a FOUC init script that sets the four data-* attributes', () => {
    const script = buildThemeInitScript(null);
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(0);
    expect(script).toContain('setAttribute');
    for (const attr of ['data-theme', 'data-style', 'data-palette', 'data-type']) {
      expect(script).toContain(attr);
    }
  });

  it('ships the token CSS as the package `./theme.css` export (single source)', () => {
    const cssPath = require.resolve('@motir/design-system/theme.css');
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toContain('@theme'); // Tailwind v4 preset — utilities generate
    expect(css).toMatch(/--el-[a-z-]+:/); // Tier-3 element tokens
    expect(css).toMatch(/\[data-palette=/); // the palette swap layer
    expect(css).toMatch(/\[data-style=/); // the style swap layer
  });
});

describe('app/globals.css imports the package token CSS (no vendored copy)', () => {
  const css = read('app/globals.css');

  it('@imports @motir/design-system/theme.css', () => {
    expect(css).toContain("@import '@motir/design-system/theme.css'");
  });

  it('drops the old hand-rolled raw-hex palette vars', () => {
    // The pre-package starter defined --bg/--text/--panel/... raw hexes; the
    // design system replaces them, so none must linger (they would be a second,
    // divergent colour source).
    expect(css).not.toMatch(/--bg:\s*#/);
    expect(css).not.toMatch(/--panel:\s*#/);
    expect(css).not.toMatch(/--text:\s*#/);
  });
});

describe('app/layout.tsx applies the project design + FOUC seam', () => {
  const layout = read('app/layout.tsx');

  it('sets the three server-resolvable axes on <html>', () => {
    expect(layout).toContain('data-style={applied.styleId}');
    expect(layout).toContain('data-palette={applied.paletteId}');
    expect(layout).toContain('data-type={applied.typeId}');
    // The project's design, from motir.design.json — the file Motir writes the
    // project's chosen ids into when it creates a repository from this starter.
    expect(layout).toContain("import projectDesign from '@/motir.design.json'");
    expect(layout).toContain('resolveAxesToApplied(projectDesign)');
  });

  it('renders the package init script and wraps children in the providers', () => {
    expect(layout).toContain('buildThemeInitScript(applied)');
    expect(layout).toContain('<ThemeProvider');
    expect(layout).toContain('<ToastProvider>');
  });

  it('loads fonts under the `-source` variable names the type axis reads', () => {
    // Naming a loader variable the bare role token (`--font-sans`) instead of
    // `--font-sans-source` leaves every `var(--font-*-source)` in theme.css
    // unresolved → the UI silently falls back to system faces.
    expect(layout).toContain('--font-sans-source');
    expect(layout).toContain('--font-serif-source');
    expect(layout).toContain('--font-mono-source');
    expect(layout).not.toMatch(/variable: '--font-sans'[^-]/);
  });

  // The font check above names three variables as substrings, so it cannot
  // notice a face the package ADDS. This one derives BOTH sides: what the
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

describe('motir.design.json is the project design, and ships as the defaults', () => {
  const design = JSON.parse(read('motir.design.json')) as Record<string, unknown>;

  it('carries exactly the three axis ids', () => {
    expect(Object.keys(design).sort()).toEqual(['paletteId', 'styleId', 'typeId']);
  });

  it('ships the registry defaults, every one a registered id', () => {
    expect(design).toEqual({
      styleId: DEFAULT_STYLE_ID,
      paletteId: DEFAULT_PALETTE_ID,
      typeId: STYLE_DEFAULT_TYPE[DEFAULT_STYLE_ID] ?? DEFAULT_TYPE_ID,
    });
    expect(isStyleId(design['styleId'])).toBe(true);
    expect(isPaletteId(design['paletteId'])).toBe(true);
    expect(isTypeId(design['typeId'])).toBe(true);
  });

  it('a chosen design reaches <html> and the init script; an unknown id falls back', () => {
    const chosen = resolveAxesToApplied({
      styleId: 'neo-brutalism',
      paletteId: 'cobalt',
      typeId: 'grotesk',
    });
    expect(chosen).toMatchObject({
      styleId: 'neo-brutalism',
      paletteId: 'cobalt',
      typeId: 'grotesk',
    });
    expect(buildThemeInitScript(chosen)).toContain('"neo-brutalism"');
    expect(resolveAxesToApplied({ ...design, paletteId: 'gone' }).paletteId).toBe(
      DEFAULT_PALETTE_ID,
    );
  });
});
