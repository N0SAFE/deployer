---
applyTo: "**"
description: "Testing strategy, SSE/high-frequency stream performance rules, deep debugging protocol"
---

## 🔴 Testing

### Frameworks

- **Vitest 2.x** (not Jest) — `vi.fn()`, `vi.mocked()`, `vi.mock()`.
- **Imports from `'vitest'`** — not `'@jest/globals'`.
- **Globals enabled** in the shared config: `describe`/`it`/`expect` are global, no imports needed in most tests.

### Test Location Conventions

| Layer | Pattern | Example |
|-------|---------|---------|
| App (`apps/api`, `apps/web`) | `*.spec.ts` colocated with source | `apps/api/src/core/utils/context-filter-logger.spec.ts` |
| Shared package (`packages/*`) | `__tests__/*.test.ts` colocated with source module | `packages/utils/orpc/src/builder/__tests__/error-builder.test.ts` |
| E2E | `*.e2e.spec.ts` with shared Postgres testcontainer setup | `apps/api/vitest.shared-postgres.e2e.ts` |

**Both patterns are intentional.** Do not force one over the other.

### Mocking Patterns

```typescript
// ✅ Vitest native — use vi.fn() and vi.mocked()
const spy = vi.fn<(input: string) => Promise<void>>()
expect(spy).toHaveBeenCalledTimes(1)

// ✅ NestJS testing module — use Test.createTestingModule
const module = await Test.createTestingModule({
  imports: [MyModule],
})
  .overrideProvider(MY_TOKEN)
  .useValue({ execute: vi.fn() })
  .compile()

// ❌ Never use jest.mock() — we're on Vitest
// ❌ Never auto-mock NestJS providers without .overrideProvider
```

### Per-App Setup Files

- `apps/api/vitest.setup.ts` — NestJS test bootstrapping
- `apps/api/vitest.setup.e2e.ts` — e2e setup
- `apps/api/vitest.global-setup.e2e.ts` + `vitest.shared-postgres.e2e.ts` — e2e with shared Postgres container (testcontainers)
- `apps/api/vitest.teardown.e2e.ts` — e2e teardown

### Coverage

- Vitest `v8` provider, outputs to `./coverage`.
- New code: target >80% line coverage on business logic. UI components: snapshot only.

---

## 🔴 Performance — SSE / High-Frequency Streams

### The SSE Update Problem

SSE events fire every ~200ms. Every event triggers a React re-render. Without optimization, this drops FPS to 1-5 and creates visible lag.

### Required Pattern for SSE-Driven Lists

```typescript
// 1. Read the raw stream into state
const liveContainers = useDockerLiveContainers({ reconcileIntervalMs: 60_000 })
const containerEntities = liveContainers.data

// 2. Defer the heavy derivation (map + sort + project) to background
const deferredContainerEntities = useDeferredValue(containerEntities)
const deferredImageEntities = useDeferredValue(imageEntities)

// 3. Heavy work uses the DEFERRED values (UI stays at 60 FPS)
const containers = useMemo(() => {
  return heavyProjection(deferredContainerEntities, deferredImageEntities)
}, [deferredContainerEntities, deferredImageEntities])

// 4. CRITICAL: data the ref/key needs must use NON-DEFERRED values
const nonDeferredContainers = useMemo(() => {
  return heavyProjection(containerEntities, imageEntities)  // ✅ raw, not deferred
}, [buildContainerProjections, containerEntities, imageEntities])
```

**Why split**: `useDeferredValue` defers a value by one render. The ref that the fetch callback reads MUST have the fresh data immediately — otherwise the table shows empty forever.

### Stable References for Heavy Children

When passing callbacks/objects to memoized children (DataTable, etc.), stabilize them:

```typescript
// ✅ Stable callback (only re-created when deps change)
const getDataTableColumns = useCallback(() => containerColumns, [containerColumns])

// ✅ Stable config (empty deps, never re-created)
const dataTableConfig = useMemo(() => ({
  enableRowSelection: true,
  enableSearch: true,
  // ...
}), [])

// ✅ Stable export config
const exportRows = useMemo(() => filteredContainers.map(toExportRow), [filteredContainers])
```

### Modal/Dialog Components

**Always** split heavy modals into two components:

1. **Trigger** (tiny): owns `useState(false)`, renders a button + conditionally mounts the content.
2. **Content** (heavy): owns all state, queries, and JSX. Only mounted when `open === true`.

This avoids running 20+ `useState` and ~10 `useQuery` hooks per row when the modal is closed.

```typescript
export function MyModalTrigger({ id, children }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>{children}</button>
      {open ? <MyModalContent id={id} open={open} onOpenChange={setOpen} /> : null}
    </>
  )
}

function MyModalContent({ id, open, onOpenChange }: MyModalContentProps) {
  // 20+ useState, 10 useQuery, 2k lines of JSX
  // Only runs when open === true
}
```

### React Compiler

This project does **not** have React Compiler enabled (verified by absence of `"react-compiler"` in build configs). All memoization is manual. Be deliberate about `useCallback`/`useMemo`.

### Audit Checklist for SSE/Stream Pages

Before committing a page that consumes a stream:

- [ ] `useDeferredValue` on the heavy derived state
- [ ] Stable callbacks for memoized children (`useCallback` with sensible deps)
- [ ] Stable configs/objects (`useMemo` with `[]` for never-changing values)
- [ ] Heavy modals split into trigger + content
- [ ] Refs for data that must be fresh (not deferred)

---

## 🔍 Deep Debugging Protocol

> When something doesn't work, **never take the easy way out**. The easy fix (a `// @ts-ignore`, a defensive `?? ""`, a try/catch that swallows) is usually a lie that hides the real problem. **Find the root cause, not a workaround.**

### The Investigation Order (Always Follow)

When you hit a problem, investigate in this order BEFORE proposing a fix:

1. **Local context** — read the file, read the function, read the test.
2. **Call sites** — `grep_search` for all callers. Read each one. What's the actual usage pattern?
3. **Recent changes** — `git log -p <file>` to see what changed. The bug is often in a recent edit.
4. **Related code** — sibling files, parent files, the same pattern in other modules.
5. **Dependency source** — read the library's TypeScript declarations. Read its source. Read its CHANGELOG.
6. **Dependency issues** — search GitHub issues for the library. Someone may have hit this.
7. **Runtime evidence** — actual logs, actual traces, actual stack traces, not "I think it's this."
8. **Reproduction** — write a minimal repro. If you can't repro, you don't understand the bug.

### The 5 Whys

For every symptom, ask "why" 5 times:

- **Symptom**: `TypeError: container.Ports is undefined`.
- **Why?** The docker entity has no `Ports` field.
- **Why?** The dockerode library returns it as undefined when no ports are bound.
- **Why?** The schema uses `.default([])` but the value was set before parsing.
- **Why?** The producer code does `{ ...entity, kind, action } as unknown as Chunk` — bypassing the schema.
- **Why?** The producer was written before Zod validation was added to the stream.
- **Root cause**: missing server-side Zod parse in the SSE stream producer.

The fix is at the root: parse at the producer. Not at the consumer with a `?? []`.

### The "I Don't Know" Rule

- **It's OK to not know.** "I don't know, let me investigate" is honest and correct.
- **It's NOT OK to fake understanding.** "It's probably X, let me just add a guard" is a lie.
- **It's NOT OK to take the easy way.** "I'll just add `?? ''` and ship it" is a lie.
- **When you don't know, say so.** Then investigate. Then propose.

### The "Why Does This Work?" Check

For every fix, ask: **"Why does this fix the symptom?"**. If you can't answer in 1 sentence, you don't understand the fix. If your answer is "I don't know, but the warning is gone", you have a workaround, not a fix.

### Forbidden Easy-Way Fixes

- ❌ `as any` to silence a type error.
- ❌ `as unknown as X` to bypass a contract.
- ❌ `// @ts-ignore` / `// @ts-expect-error` to silence the compiler.
- ❌ `?? defaultValue` to silence a "possibly undefined" warning.
- ❌ `try { ... } catch (e) {}` to silence a runtime error.
- ❌ `eslint-disable` to silence a lint warning.
- ❌ `// eslint-disable-next-line` ditto.
- ❌ "Just don't validate that" / "Just don't check this edge case".
- ❌ "I'll add a test that demonstrates the bug, then ship a fix that doesn't address the bug" — lying to yourself.

### When You Hit a Wall

If after deep investigation you can't find the root cause:
1. **State the gap**: "I investigated X, Y, Z, but couldn't determine the cause."
2. **Propose a theory**: "My best guess is that <X>, because <Y>."
3. **Propose how to validate**: "We could verify this by <running Z / adding logging / writing a repro>."
4. **Ask the user for input** if the answer affects the architecture.

---
