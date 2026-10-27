# Bun `lint` and type information: why an ESLint-style typed rule cannot warn today

Audit only — nothing here is implemented. Snapshot taken 2026-10-26 on
`rewrite-v3`, working tree dirty. All commands were run on this machine
(Bun **1.4.4**), inside `apps/api-services/services/identity` unless stated.

**Question.** Can a lint rule warn when a `.effect()` handler leaves an Effect
failure unhandled — i.e. when the handler's yielded effects carry a
`Data.TaggedError` that never became an `ORPCError`?

**Answer.** Not with `bun lint` as it exists in 1.4.4. The type information Bun
does have is only visible to its **native** rules; rule code that comes from a
JavaScript plugin (ours included) runs with `parserServices.program === null`,
so it cannot read an Effect's error channel. The rest of this document is the
evidence and the options that remain.

---

## 1. What `bun lint` is

`bun lint` is not ESLint. It is a native linter with its own rule catalog that
*also* loads `eslint.config.ts`, runs the ESLint-compatible plugins it finds, and
runs whatever rules it does not implement itself in JavaScript.

Measured in `apps/api-services/services/identity`:

```console
$ bun lint --doctor
Using eslint.config.ts (ESLint flat config)
Using ../../../../bunfig.toml ([lint])

  46 files to lint

  136 rules run natively
    3 rules run in JavaScript
        ../../../../tooling/eslint/plugins/progress/dist/index.mjs    1
        eslint-plugin-turbo                                           1
        eslint.config.ts                                              1

Still needed:   eslint, zod (eslint.config.ts loads them)
```

`bun lint --rules` lists the catalog by namespace: `bun/*`, `bun:test/*`,
`typescript/*`, `eslint/*`, `react/*`, `zod/*`, `axios/*`, `fast-check/*`,
`jsx/*`, `format`. The native `typescript/*` set already contains type-aware
rules (`await-thenable`, `no-floating-promises`, `no-unnecessary-condition`,
`no-misused-promises`, …).

## 2. Type information reaches native rules only

Native type-aware rules work. On a scratch file
(`/tmp/opencode/typelint/a.ts`) with a discarded promise:

```console
$ bun lint --type-aware a.ts
<error file="a.ts" line="3" column="3" rule="@typescript-eslint/no-floating-promises">
Promises must be awaited, end with a call to .catch, … or be explicitly marked as ignored with the `void` operator.
```

`--type-aware` is what turns that class of rule on (`--help --all` lists
`--type-aware`, `--no-type-aware`, `--tsconfig`, `--type-check`,
`--infer-globals`). Timings on identity (46 files, warm): **4.47 s** default vs
**5.12 s** with `--type-aware`, so the type engine is not the expensive part.

JavaScript rules get the *shape* of typescript-eslint's parser services but not
the substance. Probe rule (flat config, `files: ["src/**/*.ts"]`, rule body
`context.sourceCode.parserServices`):

```
PROBE languageOptions keys: [ "ecmaVersion", "sourceType", "globals", "parserOptions", "parser" ]
PROBE program is null          ← with --type-aware, using the app's real config
```

And when the rule actually asks for the checker, as typescript-eslint rules do:

```console
$ bun lint --type-aware --config=probe.config.ts b.ts
error: Error while loading rule 'local/types': null is not an object (evaluating 'services.program.getTypeChecker')
```

The `parserServices` object does carry the *keys* (`program`,
`esTreeNodeToTSNodeMap`, `tsNodeToESTreeNodeMap`), which is why a rule can look
supported and then fail at the first call. Both `--type-aware` and the default
mode behave the same for JS rules.

## 3. Latest build check (2026-10-26)

Nothing newer fixes it. Stable 1.4.4 (published 2026-10-22) is the newest
release; the canary build of 2026-10-24 behaves identically:

```console
$ /tmp/opencode/bun-canary/bun-linux-x64/bun --revision
1.4.4-canary.1+a8fcd319b

$ /tmp/opencode/bun-canary/bun-linux-x64/bun lint --type-aware --config=probe.config.ts b.ts
PROBE program is null
PROBE checker failed: TypeError: null is not an object (evaluating 'services.program.getTypeChecker')
```

Upstream, this is known and the direction is the opposite of "expose the
checker":

| Ref | State | What it says |
|---|---|---|
| [oven-sh/bun#45754](https://github.com/oven-sh/bun/issues/45754) | open | typescript-eslint aliased as `ts/` "runs in JavaScript", so `ts/await-thenable` and `ts/no-floating-promises` "did not run because rules that run in JavaScript cannot use type information" (exit 2) |
| [oven-sh/bun#45574](https://github.com/oven-sh/bun/pull/45574) | open | `parserServices.program` should **throw** when the config asks for types, instead of `null` — i.e. fail loudly, still no `Program` |
| [oven-sh/bun#46044](https://github.com/oven-sh/bun/pull/46044) | open | run built-in plugins natively under whatever name the config registers them — closes the aliasing gap for typescript-eslint, not for custom rules |

So the `null` we measured is intentional: a JavaScript rule is never handed a
type checker, and once #45574 lands the failure becomes explicit (`exit 2`)
instead of a silent `null`.

## 4. Why

- `bun lint` parses and type-checks TypeScript in its own native pipeline. The
  type checker is not the TypeScript compiler's `Program`; it is Bun's own
  software, reachable from Zig/Rust rule implementations.
- Rules that are reimplemented natively read that state directly. Rules loaded
  from an npm plugin execute in Bun's JavaScript runtime, which has no handle on
  the native checker, so the bridge hands them `program: null`.
- A rule that needs types is therefore either skipped up front or crashes on its
  first `getTypeChecker()` / `getTypeAtLocation()` call. The repo already
  recorded the first behaviour in `bunfig.toml`:

  > a rule that runs in JavaScript cannot reach Bun's type information. Without
  > this key Bun exits 2 on every NestJS workspace ("2 rules did not run because
  > rules that run in JavaScript cannot use type information") … `allowUnsupported = true`

  That key is why such rules pass silently instead of failing the lint.

## 5. What this means for "warn on unhandled Effect failures"

The information needed lives only in the type of the generator passed to
`.effect()`: `@orpc/effect` types it as
`Generator<Effect.Effect<any, any, Services>, TReturn, never>`, so the handler's
failures are visible only through the type checker. There is:

- no native `bun lint` rule that inspects generator yield types (the catalog has
  nothing Effect-related, and Effect is not a framework Bun models);
- no way to add a native rule (plugins are JavaScript-only);
- no way for a JavaScript rule to reach the checker (section 2).

`@orpc/effect` accepting `E = any` is the root cause: the runtime cannot
distinguish an unmapped domain error from a bug, so it becomes a 500 while the
contract advertises `NOT_FOUND`.

## 6. Options, audited

| Option | Feasible | Cost | Notes |
|---|---|---|---|
| Native `bun lint` rule | No | — | Requires a Bun release; there is no plugin surface for native rules. Upstream is heading the other way (#45574 makes the `null` program throw), so a custom *native* rule is not on offer. |
| Constrain `.effect()` upstream in `@orpc/effect` | Yes | Upstream PR + beta churn | Smallest permanent fix: `TYield extends Effect.Effect<any, ORPCError<…>, InferEffectServices<Ctx>>`. Not ours to ship. |
| Real ESLint (Node) + typescript-eslint custom rule | Yes | Second lint pipeline | `@deployer/config-eslint` already depends on `eslint` and `@typescript-eslint/{parser,eslint-plugin}` (`tooling/eslint/package.json`). A local rule would get a real `Program` via `parserOptions.projectService`. Conflicts with the repo rule "never invoke `eslint`/`tsc` directly"; would need a dedicated `bun check --no-script` step and a second config, and it is materially slower than `bun lint`. |
| `bun check --no-script` script using the TypeScript API | Yes | ~100 LOC, one script | Walk `.effect(...)` call expressions with `ts.createProgram`, read the argument's return type, extract the yield type's error channel, report non-`ORPCError` failures. Same data ESLint would use, no new linter, can emit warnings without failing. Fits the existing `bun check --no-script` gate. |
| Type-level enforcement in the builder | Works, rejected | New API in every controller | A `.effect()` overload narrowed to `ORPCError` (see §7). Proven to compile-fail unhandled failures, but it adds a wrapper to every handler and was rejected as the wrong shape. |
| Interface augmentation of `@orpc/server` | No | — | `declare module` merges, but the augmented `effect` overload lands *last*, so `@orpc/effect`'s permissive one still matches first. Verified with an explicit type-argument probe. |
| Runtime guard/log only | Yes | None | Today's behaviour: unknown failures become 500s. No static signal. |

Verified against stable 1.4.4 and the 2026-10-24 canary (§3): neither hands a `Program` to a JavaScript rule.

Recommendation if this is ever picked up: the `bun check --no-script` script (fourth row).
It is the only option that is a warning rather than a breaking API, keeps
`bun lint` untouched, and uses the same compiler the repo already runs for
`type-check`. Second choice: the upstream `@orpc/effect` constraint, which makes
the mistake impossible rather than reported.

## 7. What was tried and removed

For the record, so it is not re-derived:

- **`checked(builder)`** — a cast that replaced the builder's `effect` with one
  requiring `Effect<unknown, ORPCError<…>, Services>` on every yield. It worked
  (type error on an unmapped `Data.TaggedError`, accepted `ORPCError` and
  `never`), preserved `input`/`context` inference and the contract output check,
  and cost one wrapper per procedure. Removed on request: it is a new API for a
  check the compiler could do at the seam instead.
- **Interface augmentation** — see the table above; the overload ordering makes
  it inert.
- **`no-restricted-syntax`** banning raw `.effect(...)` — a syntactic companion
  to `checked()`; removed with it.

## 8. Reproduce

```bash
# native type-aware rule fires
mkdir -p /tmp/opencode/typelint && cd /tmp/opencode/typelint
printf '{\n  "compilerOptions": { "strict": true }\n}\n' > tsconfig.json
printf 'declare function getNumber(): Promise<number>;\nexport function go(): void {\n  getNumber();\n}\n' > a.ts
bun lint --type-aware a.ts

# JS rules get no program (in the app that owns the real config)
cd apps/api-services/services/identity
bun lint --type-aware --no-fix --config=probe.config.ts src/modules/user/controllers/user.controller.ts
# probe.config.ts: plugins.local.rules.types logs context.sourceCode.parserServices.program

# inventory of native vs JavaScript rules
bun lint --doctor
bun lint --rules
```
