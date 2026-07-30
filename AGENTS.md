- To regenerate the JavaScript SDK, run `./tooling/repo/generate.ts` from the repo root.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `main`.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## Style Guide

- Keep things in one function unless composable or reusable
- Avoid unnecessary destructuring. Instead of `const { a, b } = obj`, use `obj.a` and `obj.b` to preserve context
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Prefer single word variable names where possible
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity

### Avoid let statements

We don't like `let` statements, especially combined with if/else statements.
Prefer `const`.

Good:

```ts
const foo = condition ? 1 : 2
```

Bad:

```ts
let foo

if (condition) foo = 1
else foo = 2
```

### Avoid else statements

Prefer early returns or using an `iife` to avoid else statements.

Good:

```ts
function foo() {
  if (condition) return 1
  return 2
}
```

Bad:

```ts
function foo() {
  if (condition) return 1
  else return 2
}
```

### Prefer single word naming

Try your best to find a single word name for your variables, functions, etc.
Only use multiple words if you cannot.

Good:

```ts
const foo = 1
const bar = 2
const baz = 3
```

Bad:

```ts
const fooBar = 1
const barBaz = 2
const bazFoo = 3
```

## Testing

You MUST avoid using `mocks` as much as possible.
Tests MUST test actual implementation, do not duplicate logic into a test.

Run the suite with `bun test` from `backend/cli`.

## Cursor Cloud specific instructions

Cloud agents use `.cursor/environment.json` (Bun 1.3.14 image + `bun install` on start).

- Typecheck: `bun run typecheck`
- CLI tests: `bun test` from `backend/cli`
- CLI in browser conditions: `bun run --cwd backend/cli --conditions=browser ./src/index.ts serve --port 4096`
- Workspace UI: from `frontend/workspace`, `bun dev -- --port 4444` (targets backend at `http://localhost:4096`)
- Do not put API keys in the repo; use Cloud Agent secrets on the [dashboard](https://cursor.com/dashboard/cloud-agents)
