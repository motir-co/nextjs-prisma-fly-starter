import {
  BACKGROUND_AREAS,
  resolveBackgroundChoice,
  type BackgroundArea,
  type BackgroundChoice,
} from '@motir/design-system';
import projectDesign from '@/motir.design.json';

/**
 * The project's background per page area, from `motir.design.json`.
 *
 * Motir writes `backgrounds: { landing, login, hero }` into that file beside the
 * three axis ids when it creates a repository from this starter (MOTIR-11607).
 * The file is read as untrusted data: a manifest written before backgrounds
 * existed has no `backgrounds` key, and a later package release can retire an
 * id. Every area resolves through the package's `resolveBackgroundChoice`, so
 * `none` stays `none` (draw nothing), a registered id stays itself, and a
 * missing or unknown one becomes the project style's default background —
 * the same fallback provisioning applies, and never an error.
 */

/** The shape read from `motir.design.json`: every field optional and opaque. */
export interface DesignManifest {
  styleId?: unknown;
  backgrounds?: unknown;
}

export function projectBackgroundFor(
  area: BackgroundArea,
  manifest: DesignManifest = projectDesign,
): BackgroundChoice {
  const backgrounds = manifest.backgrounds;
  const stored =
    backgrounds !== null && typeof backgrounds === 'object'
      ? (backgrounds as Partial<Record<BackgroundArea, unknown>>)[area]
      : undefined;
  return resolveBackgroundChoice(stored, manifest.styleId);
}

/** Every area's resolved background, in the package's area order. */
export function projectBackgrounds(
  manifest: DesignManifest = projectDesign,
): Record<BackgroundArea, BackgroundChoice> {
  return Object.fromEntries(
    BACKGROUND_AREAS.map((area) => [area, projectBackgroundFor(area, manifest)]),
  ) as Record<BackgroundArea, BackgroundChoice>;
}
