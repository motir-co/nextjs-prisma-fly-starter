import { Background, type BackgroundArea } from '@motir/design-system';
import { projectBackgroundFor, type DesignManifest } from '@/lib/design/project-backgrounds';

/**
 * Draws the background `motir.design.json` names for one page area, behind its
 * parent. The package's `<Background>` is an absolutely placed canvas at
 * `-z-10`, so the parent must be `relative isolate` (its own stacking context),
 * or the canvas slips behind the page. `focusId` names the element the
 * background gathers around and clears behind. `none` renders nothing.
 *
 * `manifest` exists for tests; the app always reads the project's own file.
 */
export function ProjectBackground({
  area,
  focusId,
  manifest,
}: Readonly<{ area: BackgroundArea; focusId?: string; manifest?: DesignManifest }>) {
  return <Background id={projectBackgroundFor(area, manifest)} focusId={focusId} />;
}
