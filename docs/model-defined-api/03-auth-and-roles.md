# 03 — Auth and Roles in a Model-Defined API

This document defines how access control is applied consistently across contract, API, and frontend layers.

---

## Access-control layers

Use a layered model:

1. **Authentication layer**
   - ORPC middleware enriches context with session/user utilities.
   - `requireAuth()` enforces authenticated context for protected procedures.

2. **Platform role layer**
   - Optional middleware for global privileges (e.g., admin/superAdmin/operator/viewer).
   - Use for platform-wide operations.

3. **Project/resource role layer**
   - Service-level checks enforce owner/collaborator role permissions.
   - Use role allowlists per operation.

4. **Frontend permission layer**
   - UI checks with permission hooks to hide/disable unauthorized actions.

---

## Role sets to standardize

Current architecture contains multiple role scopes:

- **Platform roles**: global control-plane privileges
- **Organization roles**: tenant-scoped membership roles
- **Project roles**: resource-scoped collaboration and deployment roles

Model-defined endpoints should always state which scope they rely on.

---

## API enforcement pattern

### Controller boundary

Each protected handler should follow:

```ts
implement(contract.endpoint)
  .use(requireAuth())
  .handler(async ({ input, context }) => {
    // delegate to service
  })
```

### Service boundary

For project-scoped resources, use role allowlist checks:

- resolve resource ownership/membership
- assert caller role is allowed for action
- throw consistent domain error when denied

This avoids role logic leakage into controllers/repositories.

---

## Policy mapping by endpoint type

| Endpoint type | Minimum requirement | Typical additional rule |
|---|---|---|
| Public health/setup bootstrap | public or setup gate | none |
| User self/profile | authenticated | user identity match |
| Project CRUD | authenticated | owner/maintainer allowlist |
| Deployment trigger/cancel | authenticated | deploy-capable project role |
| Runtime operations (container/image action) | authenticated | project role + platform ops constraints |
| Platform admin | authenticated | platform role allowlist |

---

## Role-aware relation expansion

When returning linked relations (`include=...`):

1. Evaluate access before expansion.
2. Expand only authorized relation branches.
3. Redact sensitive fields from linked entities.
4. Return optional/null relation fields when unauthorized instead of overexposing data, regardless of field placement in the schema.

---

## Frontend alignment

Frontend must mirror backend policy intent:

- Use permission hooks for render gating (`usePermissions`, `useOrganizationPermissions`, `useCombinedPermissions`).
- Do not rely on UI-only checks; backend remains source of truth.
- Keep mutation availability and action buttons aligned with role checks.

---

## Contract-level policy annotation (recommended)

For maintainability, annotate each endpoint in documentation with:

- `auth`: `public` | `required`
- `policyScope`: `platform` | `organization` | `project`
- `allowedRoles`: explicit role list or policy key

Even if enforced in middleware/service, this makes endpoint capabilities auditable from contract docs.
