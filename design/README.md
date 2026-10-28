# `design/` — the design assets, and how they reach your work items

A design task's deliverable lives here, and it is **two files per surface**,
under an area folder:

```
design/
  <area>/                            e.g. work-items, settings, onboarding
    design-notes.md                  ONE per area — the spec, indexing that area's surfaces
    <surface>.mock.html              the mockup, self-contained, built from the real design system
    <surface>--<change>.mock.html    a later CHANGE to that surface, drawn as a delta
```

A surface with a mock and no notes is **incomplete**. There is no image export:
the mock itself renders on the work item, so a screenshot of it would only be a
second copy of what the reviewer is already looking at. Do not start a new
surface in a design-tool source format that can only be reviewed through an
export — draw it as a mock.

## Why the folder exists at all

Two reasons, and the second is the one people miss.

**1. It is what the next agent builds to.** A UI task starts by opening the
mockup for its surface. Without one it improvises, and you get a screen nobody
designed.

**2. It is what a reviewer approves — when work waits on it.** When another work
item is `blocked_by` the design task, the agent that drew the design calls
Motir's **`publish_design_result`** tool, naming the card, and a reviewer reads
the result **on the card in Motir**: the mock in a sandboxed frame, with the
area's note **one link away**. No GitHub trip, no raw-file URLs. Approving it is
what lets the waiting work start.

> ⚠️ **When work waits on the design, nothing else makes that call.** There is no
> CI lane, no check and no background job that publishes for you. A design task
> that something is `blocked_by`, that commits its files and never calls the
> tool, looks _identical_ to one that succeeded — files written, commit landed,
> pull request open, checks green — and the card is empty. The publish is the
> last step of that task, not a consequence of it.

## Publish ONLY when work waits on the design

A published result raises an approval that waits on a person, and that approval
is only worth asking for when something is held up by its answer. So:

- **An open work item is `blocked_by` the design card** → publish the result.
  A bug whose fix needs a design first is this case too: that bug is
  `blocked_by` its design.
- **Nothing is `blocked_by` it** — a design defect fixed in place, a record of a
  surface as built → **publish nothing.** Its pull request is its review. The
  server refuses the call anyway (`DESIGN_EVIDENCE_NOTHING_WAITS`), and so does
  the upload-grant call, before any bytes move. A dependent that is done,
  cancelled or archived does not count.

## A change to an existing design is a NEW delta mock

**Do not edit the existing mock.** Draw the change in a new
`<surface>--<change>.mock.html` beside it, holding **only the panels that
change**, and add a new `##` section to the area's `design-notes.md` that cites
the section and the mock it amends. The older mock stays as the record of the
moment it was drawn — it is not a specification to keep current, because every
build starts by rendering what the app actually ships. The result for a change
publishes the delta mock(s) only.

## What each file is

### `design-notes.md` — per AREA, not per surface

One file per area, opening with a table that indexes the area's surfaces, then a
`##` section per surface (or per change): the primitives it composes, the exact
copy, and the colour + shape token for every element.

> **The note is published as a FILE and shown as a LINK.** Send the area's
> `design-notes.md` as the one `note_file` asset. The result does not render the
> note inline, and the call has no inline-note field any more — sending one is
> refused by name (`DESIGN_EVIDENCE_NOTE_MD_RETIRED`). The note is written for
> the agents that build to the design; the reviewer opens it when they want it.

### `<surface>.mock.html` — the source of truth

Self-contained HTML built from the **real** design system: your `components/ui/*`
primitives' markup and your `globals.css` tokens. Colour through the semantic
element tokens, never the raw palette; shape through the element-semantic
radius / spacing / size tokens, never a fixed `rounded-md` / `p-2` / `h-9`.

A mock is usually a multi-panel board — closed and open, empty and populated,
light and dark — because the states are the part a code task cannot invent.

> **It renders in a fully restrictive sandbox.** When Motir shows your mock it
> loads it in an iframe with neither `allow-scripts` nor `allow-same-origin`, so
> a mock that needs JavaScript to render appears inert. Keep mocks static: inline
> CSS, no `<script>`, no remote assets.

## How a design reaches the right card

**You name it.** The call takes the work item's key, so nothing is inferred from
a branch, a pull-request title or a diff:

```
publish_design_result  key: "ACME-42"
  assets: [ each *.mock.html as `mock`   (for a change: the delta mock(s) only),
            design-notes.md as `note_file` (exactly one) ]
```

A result is **one or more mocks plus exactly one note file**, and the server
refuses anything else by name: an image asset (`DESIGN_EVIDENCE_IMAGE_RETIRED`),
no mock (`DESIGN_EVIDENCE_MOCK_REQUIRED`), or zero or several note files
(`DESIGN_EVIDENCE_NOTE_FILE_REQUIRED`). A retired input is refused rather than
silently dropped, so an agent is never told it published something it did not.

Naming the card is the point of the design, and it is worth one sentence on why.
The previous mechanism read a `<KEY>-<number>` out of the branch ref and then the
title — so a pull request that touched `design/**` in passing published those
assets onto whichever card its own branch happened to name, silently, under a
green check. A publisher that guesses its target from a string somebody typed
will eventually guess wrong. This one is told.

The server also refuses the two targeting mistakes it can see: a **container**
target (a design result belongs to the leaf that produced it) and a key that is
not a child of a declared `withinParentKey`.

## Setup

**Nothing.** The agent publishes with its own Motir credential — the same one it
already holds to read the card and move it — on the `work_item:edit` permission
it already has.

There is no repository secret to set, no `MOTIR_UPLOAD_TOKEN`, no workflow to
enable and no OIDC permission to grant. If you are publishing from something
that is not an MCP client — your own CI, a design tool, a script — the REST
route `POST /api/work-items/{id}/design-evidence` is still there and is the
supported door for it, under the same rules.
