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

describe('app/layout.tsx applies the default design + FOUC seam', () => {
  const layout = read('app/layout.tsx');

  it('sets the three server-resolvable axes on <html>', () => {
    expect(layout).toContain('data-style={applied.styleId}');
    expect(layout).toContain('data-palette={applied.paletteId}');
    expect(layout).toContain('data-type={applied.typeId}');
    expect(layout).toContain('resolveAxesToApplied({})');
  });

  it('renders the package init script and wraps children in the providers', () => {
    expect(layout).toContain('buildThemeInitScript(null)');
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
});
