# Local verification

Bugfix RCA and the fix index live in [`docs/bugfix.md`](../bugfix.md).

Before pushing to `main` (or opening a PR), run the same gates CI enforces, so a
red build never reaches the default branch.

```bash
bun install --frozen-lockfile                         # verify manifest/lockfile consistency
bun run typecheck                                     # all workspaces (tsgo), CI "Typecheck"
bun run --cwd frontend/workspace build                # assets required by server tests
bun run --cwd backend/cli script/generate-web-assets.ts
bun run --cwd backend/cli test:coverage               # one full suite + coverage report, CI "Test"
```

Formatting is a separate required gate:

```bash
bunx prettier --check .                  # CI "Format"
bunx prettier --write .                  # fix in place
```

Notes:

- `.mdx` documentation pages are intentionally excluded from prettier (its MDX
  parser is deprecated and can mangle JSX-in-markdown). Keep them plain-markdown
  and let the docs build validate them.
- The model catalog is fixtured in tests, so the suite is deterministic and runs
  offline; a nightly job checks the live catalog for delistings separately.
- Run focused tests from `backend/cli` with `bun test <files>`. They keep the
  normal fast path; only `test:coverage` enables the full coverage report.
- Bun coverage only includes files loaded by the suite. The planned static floor
  will be a regression guard, not proof that every new source file was imported.
- Atlas-dependent code paths degrade gracefully when signed out or offline —
  exercise both states when touching them.
