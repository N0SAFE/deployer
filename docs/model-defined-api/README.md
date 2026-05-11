# Model-Defined API Transformation (v3)

This folder is a dedicated blueprint for transforming the API into a fully model-defined architecture.

The goal is to make every endpoint contract derive from explicit models (User, Project, Service, Deployment, Container, Image, etc.), with typed relations, consistent validation, first-class filtering, and end-to-end ORPC + role-aware integration from backend to frontend.

---

## What this architecture guarantees

1. **Model-first contracts**
   - Contracts start from canonical Zod entity schemas.
   - No ad-hoc endpoint payloads when a model exists.

2. **Typed relations**
  - Relations are defined explicitly with `z.lazy(() => relatedSchema)`.
  - Relation fields can be placed anywhere in the model schema (top-level or nested), not only under a dedicated `relations` key.
  - Relation capabilities are detected from `z.lazy` usage.
   - Relation expansion is controlled by typed include paths (not free-form strings).

3. **Builder-defined endpoint capabilities**
   - Each endpoint declares exactly what it accepts and returns through fluent builders.
   - List endpoints use reusable filter/pagination/sorting configs.

4. **Policy-aware execution**
   - Access checks are enforced consistently via ORPC middleware + service-level role checks.
   - Role handling is visible in both API and UI layers.

5. **Contract-to-UI continuity**
   - Web domains consume ORPC contracts through `endpoints.ts`, `hooks.ts`, and `invalidations.ts`.
   - UI fetch capabilities stay synchronized with contract schemas.

---

## Guide map

- `01-model-catalog-and-relations.md`
  - Canonical model structure, required models, and relation conventions.
- `02-contract-builders-and-endpoints.md`
  - Builder-based contract design for CRUD/list/custom/stream endpoints.
- `03-auth-and-roles.md`
  - Role strategy and enforcement from ORPC middleware to UI permissions.
- `04-backend-execution-model.md`
  - Controller/service/repository execution pipeline for model-defined endpoints.
- `05-frontend-contract-consumption.md`
  - Web domain consumption pattern and relation-aware querying.
- `08-advanced-builder-control-patterns.md`
  - Builder-everywhere execution model (controller → service → repository) and strict user-input control pipelines.
- `09-service-implementation-&-hook-system.md`
  - Proposed service orchestration + hook pipeline for new builder-based features, wired to existing v3 module boundaries.
- `06-migration-checklist.md`
  - Practical step-by-step migration sequence and definition of done.
- `07-evidence-from-current-codebase.md`
  - Existing repository patterns validating this approach.

---

## Recommended adoption order

1. Start with `01` and define/normalize model schemas.
2. Apply `02` to rebuild contracts with builders.
3. Apply `03` before exposing endpoints to clients.
4. Implement backend flow with `04`.
5. Wire frontend per `05`.
6. Execute rollout using `06`.
