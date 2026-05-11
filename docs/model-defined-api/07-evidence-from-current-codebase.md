# 07 — Evidence from Current Codebase

This document shows that the model-defined architecture is already partially present and can be generalized consistently.

---

## Fluent list/filter builder exists and is production-used

Evidence:

- `v3/packages/contracts/api/modules/project/list.ts`
- `v3/packages/contracts/api/modules/service/list.ts`
- `v3/packages/contracts/api/modules/docker/images/list.ts`
- `v3/packages/contracts/api/modules/docker/containers/shared.ts`
- `v3/packages/utils/orpc/src/standard/zod/list-builder.ts`

Observed patterns:

- `standard.zod(modelSchema, "model")`
- `createFilterConfig(ops).withPagination().withSorting().withFiltering().buildConfig()`
- `ops.list(config).build()`

---

## Typed relation schemas with `z.lazy` already exist

Evidence:

- `v3/packages/contracts/entities/src/entities/docker/containers/relations.schema.ts`
- `v3/packages/contracts/entities/src/entities/docker/images/relations.schema.ts`
- `v3/packages/contracts/entities/src/entities/docker/containers/links.schema.ts`

Observed patterns:

- relation fields use `z.lazy(() => relatedSchema)`
- relation information is encoded by `z.lazy` usage; placement can be in dedicated relation objects or other schema positions
- include path allowlists defined via enums (`dockerContainerLinkPathSchema`)

---

## Builder-based custom endpoint definitions are present

Evidence:

- `v3/packages/contracts/api/modules/docker/containers/linked-list.ts`
- `v3/packages/contracts/api/modules/docker/containers/runtime-action.ts`
- `v3/packages/contracts/api/modules/docker/images/inspect.ts`
- `v3/packages/contracts/api/modules/project/stream.ts`

Observed patterns:

- custom path declarations through `.path(...)`
- typed query/body composition through `.input((b) => ...)`
- typed output/body/observable through `.output((b) => ...)`

---

## ORPC middleware + role policy infrastructure is present

Evidence:

- `v3/apps/api/src/core/modules/auth/orpc/middlewares.ts`
- `v3/apps/api/src/core/modules/project/services/project-access.service.ts`
- `v3/packages/utils/auth/src/permissions/config.ts`

Observed patterns:

- `requireAuth()` context narrowing and auth enforcement
- `requirePlatformRole(...)` middleware for platform-level policies
- project collaborator role checks (`assertProjectAccess(...)`)

---

## Controllers are already contract-bound and auth-gated

Evidence:

- `v3/apps/api/src/modules/project/controllers/project.controller.ts`
- `v3/apps/api/src/modules/service/controllers/service.controller.ts`
- `v3/apps/api/src/modules/user/controllers/user.controller.ts`

Observed patterns:

- `@Implement(contract.endpoint)` per handler
- `implement(contract.endpoint).use(requireAuth()).handler(...)`
- thin controller delegation to services

---

## Web domain data layer already mirrors ORPC contracts

Evidence:

- `v3/apps/web/src/domains/project/endpoints.ts`
- `v3/apps/web/src/domains/project/hooks.ts`
- `v3/apps/web/src/domains/project/invalidations.ts`
- `v3/apps/web/src/domains/docker/endpoints.ts`
- `v3/apps/web/src/domains/docker/hooks.ts`

Observed patterns:

- domain endpoints map directly to ORPC client contract tree
- hooks consume typed query/mutation options
- invalidation rules are endpoint-aware and input-aware

---

## Root contract composition is already modular

Evidence:

- `v3/packages/contracts/api/index.ts`
- `v3/packages/contracts/api/modules/project/index.ts`
- `v3/packages/contracts/api/modules/service/index.ts`
- `v3/packages/contracts/api/modules/docker/containers/index.ts`

Observed patterns:

- module routers composed under stable top-level keys
- capability grouping by subrouters (`crud`, `lifecycle`, `streams`, etc.)

---

## Conclusion

The repository already contains all primitives required for a model-defined API architecture. The migration is primarily a standardization effort:

1. complete model coverage across first-class resources,
2. normalize relation patterns,
3. enforce builder-defined endpoint capabilities everywhere,
4. keep role enforcement and frontend consumption aligned to contract definitions.
