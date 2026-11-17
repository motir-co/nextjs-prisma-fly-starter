import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_AREAS,
  BACKGROUND_IDS,
  BACKGROUND_NONE,
  DEFAULT_BACKGROUND_ID,
  defaultBackgroundForStyle,
  type BackgroundArea,
} from '@motir/design-system';
import { ProjectBackground } from '@/components/ProjectBackground';
import {
  projectBackgroundFor,
  projectBackgrounds,
  type DesignManifest,
} from '@/lib/design/project-backgrounds';

// MOTIR-11612 — motir.design.json names a background per page area (MOTIR-11607
// writes it at provisioning), and the landing page, its hero and the sign-in
// frame draw it. These pin the read (every id and `none` in every area, the
// package's fallback for a missing key or an unknown id) and the three
// placements.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(resolve(repoRoot, rel), 'utf8');

const CHOICES = [...BACKGROUND_IDS, BACKGROUND_NONE];

function render(area: BackgroundArea, manifest: DesignManifest, focusId?: string) {
  return renderToStaticMarkup(createElement(ProjectBackground, { area, manifest, focusId }));
}

describe('each area draws the background the manifest names', () => {
  for (const area of BACKGROUND_AREAS) {
    for (const id of BACKGROUND_IDS) {
      it(`${area}: ${id} draws its canvas`, () => {
        const manifest = { styleId: 'warm-editorial', backgrounds: { [area]: id } };
        expect(projectBackgroundFor(area, manifest)).toBe(id);
        const html = render(area, manifest, 'focus-el');
        expect(html).toMatch(/^<canvas /);
        expect(html).toContain(`data-background="${id}"`);
        expect(html).toContain('data-background-focus="focus-el"');
        expect(html).toContain('aria-hidden="true"');
      });
    }

    it(`${area}: none draws nothing`, () => {
      const manifest = { backgrounds: { [area]: BACKGROUND_NONE } };
      expect(projectBackgroundFor(area, manifest)).toBe(BACKGROUND_NONE);
      expect(render(area, manifest)).toBe('');
    });
  }

  it('reads each area independently of the others', () => {
    const backgrounds = { landing: 'aurora', login: BACKGROUND_NONE, hero: 'rule110' };
    expect(projectBackgrounds({ backgrounds })).toEqual(backgrounds);
  });
});

describe('a manifest without backgrounds, or with an unknown id, gets the package default', () => {
  const fallback = defaultBackgroundForStyle('warm-editorial');

  it.each<[string, DesignManifest]>([
    ['no backgrounds key', { styleId: 'warm-editorial' }],
    ['backgrounds: null', { styleId: 'warm-editorial', backgrounds: null }],
    ['backgrounds not an object', { styleId: 'warm-editorial', backgrounds: 'wave' }],
    ['an empty backgrounds object', { styleId: 'warm-editorial', backgrounds: {} }],
    [
      'an unknown id in every area',
      { styleId: 'warm-editorial', backgrounds: { landing: 'gone', login: 7, hero: '' } },
    ],
  ])('%s', (_label, manifest) => {
    for (const area of BACKGROUND_AREAS) {
      expect(projectBackgroundFor(area, manifest)).toBe(fallback);
      expect(render(area, manifest)).toContain(`data-background="${fallback}"`);
    }
  });

  it("follows an unknown style to the registry's default background", () => {
    expect(projectBackgroundFor('hero', { styleId: 'no-such-style' })).toBe(DEFAULT_BACKGROUND_ID);
  });

  it('an empty manifest renders without an error', () => {
    for (const area of BACKGROUND_AREAS) {
      expect(() => render(area, {})).not.toThrow();
    }
  });
});

describe("the starter's own manifest", () => {
  it('names a registered background or none for every area', () => {
    const design = JSON.parse(read('motir.design.json')) as DesignManifest;
    const backgrounds = projectBackgrounds(design);
    for (const area of BACKGROUND_AREAS) {
      expect(CHOICES).toContain(backgrounds[area]);
    }
  });

  it('is what the app reads when no manifest is passed', () => {
    const design = JSON.parse(read('motir.design.json')) as DesignManifest;
    expect(projectBackgrounds()).toEqual(projectBackgrounds(design));
  });
});

describe('the three placements', () => {
  const page = read('app/page.tsx');
  const auth = read('app/(auth)/layout.tsx');

  it('the landing page draws `landing` behind the page and `hero` behind its hero section', () => {
    expect(page).toContain('<ProjectBackground area="landing" focusId={HERO_SECTION_ID} />');
    expect(page).toContain('<ProjectBackground area="hero" focusId={HERO_CARD_ID} />');
    // The hero gathers around the card that is its main control.
    expect(page).toContain('id={HERO_CARD_ID}');
    expect(page).toContain('id={HERO_SECTION_ID}');
  });

  it('the sign-in frame draws `login` gathered around the auth card', () => {
    expect(auth).toContain('<ProjectBackground area="login" focusId={AUTH_CARD_ID} />');
    expect(auth).toContain('id={AUTH_CARD_ID}');
  });

  it('every parent of a background is its own stacking context', () => {
    // The canvas is `absolute inset-0 -z-10`: without `relative isolate` on
    // its parent it is positioned against, and painted behind, the wrong box.
    expect(page.match(/relative isolate/g)).toHaveLength(2);
    expect(auth).toContain('relative isolate');
  });
});
