import { TokensSpecimen } from '@motir/design-system';

export const metadata = {
  title: 'Design tokens · Motir design system',
  description:
    'Live specimen of the Motir 3-axis design system (Colour · Style · Type) — the same tokens, primitives, and axis pickers this starter ships, straight from @motir/design-system.',
};

/**
 * `/tokens` — the shipped design-system specimen, rendered verbatim from the
 * package (`@motir/design-system`). This is the SAME `TokensSpecimen` that
 * backs motir-core's own token gallery, so a scaffolded product gets a live,
 * always-in-sync reference of every primitive + the axis swap controls with
 * zero bespoke code. Flip the axis pickers at the top to see the whole system
 * re-skin (Colour) and re-shape (Style / Type) live.
 */
export default function TokensPage() {
  return <TokensSpecimen />;
}
