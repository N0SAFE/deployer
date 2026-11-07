# The service implementation rule — no forwarding, no ports record, no generics

> **Status:** canonical, **normative**
> **Applies to:** every service under `apps/api/services/*`, `apps/api/bff` and `apps/api/shared`
> **Enforced by:** code review, the lint config, and the migration gates in
> `docs/architecture/effect-migration-audit-2026-11-06.md`

A service declares its operations and the logic lives **in the class that declares them**. The class yields the collaborator an
operation needs at the moment it needs it, then does the work. There is no intermediate object between the declaration and the
logic.

## The rule

```ts
export class IngressEdgeService extends Context.Service<IngressEdgeService, IngressEdgeServiceShape>()('fleet/IngressEdgeService') {
    static readonly live = class IngressEdgeServiceImpl implements IngressEdgeServiceShape {
        getState(): ReturnType<IngressEdgeServiceShape['getState']> {
            return Effect.gen({ self: this }, function* () {
                const lanesPort = yield* IngressLanesPort     // yielded HERE, in this operation
                const lanes = yield* lanesPort.getLanes()
                return { lanes /* … the decision, written here … */ }
            })
        }
    }
}
```

`apps/api/services/fleet/src/modules/reachability/services/ingress-edge.service.ts` is the reference. `apps/api/services/health`
(`HealthService`), node-agent `NodeState` and `FleetSecrets`, fleet `SecretInventory` and `Enrollment` follow it too.

## What is banned, and why

| Banned | Looks like | Why it is a bug |
|---|---|---|
| **The ports record** | `type Ports = { lanes: …; edges: …; dns: … }` plus `const portsOf = Effect.gen(… yield* each tag …)` | The record exists only to be handed to something else. It couples every operation to every collaborator, so adding a collaborator touches one type and dozens of call sites, and a test must provide the whole set even for an operation that reads two of them. |
| **The forwarding shape** | `static live` whose methods are `return Effect.flatMap(portsOf, (p) => implOverPorts(p).getState())`, with `function implOverPorts(ports): XShape` holding the real body | The class is a façade over a free function that is itself a shape. Two declarations of the same interface, one of which is dead weight; a reader has to jump twice to find the logic; the requirement channel widens to the union of everything. |
| **The `<X>Ports` union** | `export type IngressEdgePorts = A \| B \| C \| …` used as the third parameter | It is the same record by another spelling. The requirement channel is written per operation by `yield*`, so it names what that operation uses. Share a type alias only when several operations genuinely share the exact same set. |
| **The single-use generic** | `class QueueWorkerPorts<TJob, TResult, TClient>` where each type parameter has exactly one instantiation | A type parameter with one value is an alias with extra steps. Write the concrete type. |
| **The pass-through service** | `class FooService { private impl = makeFoo(); foo(a) { return this.impl.foo(a) } }` | A method that forwards tells the reader nothing and the compiler nothing. Move the logic into the declaring class, or delete the wrapper and export the thing being called. |

## What is allowed, and where the line is

- **A plain function with no collaborators.** Pure projection, mapping, planning, parsing: `planLaneDnsRecords(lanes, facts)`,
  `toMeshView(status, view)`, `consoleUrls(lanes, secure, origin)`. It takes values and returns a value, so it is testable without a
  context and belongs in a file of its own.
- **A `private` helper method on `live`** when the logic needs a collaborator and is shared by more than one operation. It declares
  the collaborators it yields in its own return type, and the operation that calls it yields nothing extra:
  `private readDoor(): Effect.Effect<…, unknown, IngressEdgePorts>`.
- **`Effect.gen({ self: this }, function* () { … })`** when a method must call a private helper. `function*` alone has no `this`, and
  capturing `this` in a closure instead is how a stale `this` reaches a spec.
- **One implementation of a shape.** The tag is the contract; `static readonly live` is the implementation; nothing else implements
  the shape. If a second implementation exists (a fake is not one), it is either the real one and the first is dead, or they are two
  services.
- **Ports as tags where a Nest-owned class is behind them** (`IngressLanesPort`, `NodeAgentPort`). A port tag exists so a service can
  depend on an abstraction instead of a Nest class — not so a service can build a record of them.

## Why this rule exists

The pattern grew out of the migration: `serviceOver(Effect.all({…}), makeX)` captured collaborators in a closure, and the mechanical
conversion kept the closure by turning it into a `Ports` record plus an `implOverPorts(ports)` factory — the same shape, one indirection
further from the declaration. The result was classes whose every method was a one-line delegation to a function that returned the
interface the class already implemented. That is a second interface, not an implementation, and it defeated the point of the migration
(one place per behaviour, a requirement channel that names what an operation uses, a fake provided only where it is read).

## Checking a file

1. Does the class implement the shape **directly**, with real bodies? If a method's whole body is `Effect.flatMap(deps, …)` or
   `implOverX(…)`, it is a forwarding method: inline it.
2. Does a `type Ports` / `portsOf` / `<X>Ports` exist? Delete the record, `yield*` the tags inside each operation, and let the
   operation's return type name its requirements.
3. Does a type parameter have exactly one instantiation? Replace it with the concrete type.
4. Do the specs still pass, and does a spec for one operation now provide only the tags that operation yields? If it still has to
   provide the whole former `Ports` union, step 2 is not finished.

```bash
# the three shapes this rule bans
grep -rnE "^type Ports = \{|satisfies Ports|function implOver|const portsOf" apps/api --include='*.ts' | grep -v spec
grep -rnE "^export type \w+Ports =" apps/api --include='*.ts' | grep -v spec
```
