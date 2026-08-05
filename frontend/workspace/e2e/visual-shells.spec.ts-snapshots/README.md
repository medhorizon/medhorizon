# Visual shell baselines

These snapshots are authoritative Linux Chromium output for Plan 08. Generate
or review them only in the dedicated `visual-a11y` workflow on `ubuntu-latest`.
The local Windows/macOS rendering must not overwrite these files.

## Commands

- Observe before the baseline is approved: `VISUAL_OBSERVE=1 bun run --cwd frontend/workspace test:e2e:visual`
- Generate candidates (Linux workflow only): `VISUAL_BASELINE_UPDATE=1 bun run --cwd frontend/workspace visual:update`
- Compare an approved baseline: `bun run --cwd frontend/workspace test:e2e:visual`

The update command refuses non-Linux hosts and requires the explicit
`VISUAL_BASELINE_UPDATE=1` guard. CI never updates or pushes snapshots. Review
the candidate artifact before copying the 20 PNGs into this directory and
setting the repository variable `VISUAL_BASELINE_READY=true`.

## Matrix and masks

The matrix contains 18 Home/Session/Settings snapshots (360x800, 768x1024,
1440x900 in light and dark) plus two Session 360px drawer-open snapshots.
`visual.ts` is the mask registry. It masks only named relative-time selectors;
the registry entry documents why each selector is nondeterministic. Cursor
state is hidden with Playwright's `caret: "hide"`; no coordinate masks are
allowed. Human review must include WCAG AA contrast checks for text over images
or gradients, which axe cannot fully evaluate.

The baseline browser and Playwright versions are the ones installed by the
repository's Linux CI setup (`bunx playwright install --with-deps`). If either
changes, regenerate and review all 20 images together.
