# 05 — Service Anatomy

> **Status:** canonical, **normative**
> **Applies to:** `apps/api/bff` and every `apps/api/services/*`
> **Answers:** the mandatory file structure and layering for every NestJS app in
> this repo.

Every app in `apps/api/` follows this structure. Deviating is a bug, not a style
choice. The rules are derived from `.github/instructions/core-rules.instructions.md`
and `docs/model-defined-api/04-backend-execution-model.md`.

## 5.1 Directory structure (mandatory)

```text
<app>/
  src/
    main.ts                       process entry (listen)
    <app>.module.ts               root module
    app.config.ts                 the ONE place NestFactory options are decided
    modules/
      <domain>/                   ONE directory per domain
        <domain>.module.ts        domain module
        <domain>.controller.ts    ORPC surface (thin)
        <domain>.service.ts       business rules
        <domain>.repository.ts    data access
        <domain>.service.spec.ts
        <domain>.controller.spec.ts
        entities/                 domain entity types (Zod-derived)
        dto/                      input/output shapes where they differ from the entity
        <subset>/                 sub-domains, recursively the same shape
  test/
  scripts/build.ts                per-app build (transpile 1:1 — see §5.6)
  package.json  tsconfig.json  eslint.config.ts
```

## 5.2 The four primitives, and only these

| Primitive | Owns | Must NOT |
|---|---|---|
| **Controller** | binding a contract to a handler, applying middleware, delegating | hold business rules, touch the repository, build queries |
| **Service** | domain rules, validation of *meaning*, orchestration, transactions | know HTTP/ORPC, build SQL |
| **Repository** | data access for **its** aggregate | hold business rules, be called from a controller |
| **Entity** | identity, shape, invariants of a domain concept | hold behaviour that needs other entities |

Anything that is none of these is one of: a **policy** object, a **mapper**, a
**client** (for another service), or a **listener**. Name it accordingly; do not
call it a "helper service".

## 5.3 A worked vertical (real shapes)

### Entity — the aggregate root

```ts
// modules/project/entities/project.entity.ts
export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly slug: Slug;
  readonly ownerId: UserId;
  readonly createdAt: Date;
}
```

Entities come from the canonical Zod schemas in `@deployer/contracts-entities`; the
`interface` is the inferred type, never a hand-written duplicate.

### Repository — all data access for the aggregate

```ts
// modules/project/project.repository.ts
@Injectable()
export class ProjectRepository {
  constructor(@Inject(PROJECT_DB) private readonly db: Db) {}

  async findById(id: ProjectId): Promise<Project | null> {
    const row = await this.db.query.projects.findFirst({ where: eq(projects.id, id) });
    return row ? toProject(row) : null;
  }

  async listByOwner(ownerId: UserId): Promise<Project[]> {
    const rows = await this.db.query.projects.findMany({ where: eq(projects.ownerId, ownerId) });
    return rows.map(toProject);
  }

  async insert(input: NewProject): Promise<Project> { /* … */ }
}
```

The `toProject` mapper is the only place a DB row becomes a domain entity.

### Service — the rules

```ts
// modules/project/project.service.ts
@Injectable()
export class ProjectService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly slugs: SlugPolicy,
  ) {}

  async rename(actor: Actor, id: ProjectId, name: string): Promise<Project> {
    const project = await this.projects.findById(id);
    if (!project) throw new NotFoundError('project', id);
    if (project.ownerId !== actor.userId) throw new ForbiddenError('not the owner');

    const slug = this.slugs.fromName(name);          // policy, not a helper
    if (await this.projects.existsBySlug(slug, id)) {
      throw new ConflictError(`slug "${slug}" is taken`);
    }
    return this.projects.update(id, { name, slug });
  }
}
```

### Controller — thin, and only transport

```ts
// modules/project/project.controller.ts
@Controller()
export class ProjectController {
  constructor(private readonly projects: ProjectService) {}

  @Implement(projectContract.rename)
  rename() {
    return implement(projectContract.rename)
      .use(requireActor())
      .handler(async ({ input, context }) =>
        this.projects.rename(context.actor, input.params.id, input.body.name),
      );
  }
}
```

The controller contains **no** rule. Reading it tells you the shape of the call and
nothing else.

## 5.4 Layering rules (enforced)

1. **No cross-domain imports.** `modules/project/**` must not import
   `modules/service/**`. Promote genuine sharing to `shared/src/core/**` or a
   dedicated package. (Measured today: 67 violations across the monolith.)
2. **Dependency direction is one-way:** controller → service → repository →
   entity. Nothing points back.
3. **A table has one owning repository.** Cross-service reads go over the network
   (BFF) or through an explicit client.
4. **No `any`, no casts, no `@ts-ignore`.** Zero assertions in new code.
5. **Constructor injection only.** No property injection, no service locator.
6. **Interfaces + tokens for cross-boundary deps** (another service's client, the
   database connection), concrete classes for in-process collaborators.
7. **Errors are typed.** `NotFoundError`, `ConflictError`, `ForbiddenError` —
   never `throw new Error(...)`.
8. **Tests per primitive**: `*.service.spec.ts` (rules), `*.controller.spec.ts`
   (binding), repository covered through the service.

## 5.5 Front-facing modules in the BFF

The BFF has a second kind of module: a **screen** module. It still follows §5.2,
with different collaborators.

```text
apps/api/bff/src/modules/
  overview/            ← a SCREEN, not a domain
    overview.module.ts
    overview.controller.ts      exposes the front-facing contract
    overview.service.ts         COMPOSES services (fan-out, join, shape)
    clients/                    typed clients to the services it needs
```

Rules specific to the BFF:

- A screen service **must not** touch a database. It has no repository.
- A screen service **composes** service calls; if it needs 3 services, it calls 3.
- A screen service owns the **front's shape**; it may rename, flatten, join,
  redact, default.
- A screen controller binds a **front-facing contract**, which is composed at
  startup from the service contracts (see [04](./04-services-and-bff.md) §4.4).

## 5.6 Build & run

Each app is a workspace package under `apps/api/`, matched by the root glob
`apps/**`. Standard scripts:

```jsonc
{
  "build":     "bun --bun scripts/build.ts",   // transpile 1:1, never bundle
  "dev":       "bun --bun --watch src/main.ts",
  "start":     "bun --bun src/main.ts",
  "type-check":"tsc --noEmit",
  "lint":      "eslint . --fix --cache",
  "test":      "vitest run"
}
```

**Transpile 1:1, never bundle.** Bun's bundler emits some classes through the
TC39 decorator path, which writes no `design:paramtypes`, so Nest resolves every
plain typed constructor parameter to `undefined`. The build rewrites `@/`
specifiers to relative paths (per-file output makes `@/x` and `./x` two module
instances) and fails if zero decorator metadata was emitted. Every app reuses
`apps/api-services/shared/server` for the bootstrap, so this is configured once.

## 5.7 The tsconfig alias contract

Every app declares the same four mappings. This is what lets shared code keep its
`@/core/*` specifiers and a module be recreated in a service with no import
churn.

```jsonc
{
  "paths": {
    "@/*":         ["./src/*"],
    "@/core/*":    ["../shared/src/core/*"],     // shared platform
    "@/config/*":  ["../shared/src/config/*"],   // shared config + migrations
    "@/auth":      ["../shared/src/auth.ts"]     // shared auth factory
  }
}
```

## 5.8 Definition of done for a service

- [ ] One directory per domain under `modules/`; entity/repository/service/controller all present
- [ ] No business rule in a controller; no data access in a service
- [ ] No cross-domain imports; sharing promoted to `shared/`
- [ ] Its contract(s) implemented with `@Implement`, one handler per procedure
- [ ] Actor resolved from the forwarded claim, never from a cookie
- [ ] Typed errors for every failure path; zero `throw new Error`
- [ ] `*.service.spec.ts` covers happy, denied, not-found, conflict
- [ ] `type-check`, `lint`, `test` green
- [ ] A Dockerfile (dev + prod) and a compose entry
