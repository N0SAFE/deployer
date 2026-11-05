# Q&A — Permissions: access requirements and the grant model

> **Module**: permissions
> **Category**: api-design (with security and integrations)
> **Last updated**: 2026-11-05
> **Design**: [`docs/architecture/access-requirements.md`](../../architecture/access-requirements.md)

Decisions taken in the 2026-11-05 review, in the order they were made. "Accepted" means the operator reviewed the
proposal and said to go with it; the wording of the answers is the operator's.

---

## Where the access declaration lives

**Q**: Is a contract that declares `access` automatically gated, or does the implementation have to do something?

**A**: Not good enough. "I would prefer this to be a pure contract declaration and if declared require to pass something in the context so we are mandatory to use the middleware gate with the custom logic." Then, after the boot-audit proposal: "in fact nothing should be declared in the contracts, that's too much; what I want is the declaration of the requirement to be done at middleware declaration as well. The goal is that nothing should be opaque and that we know what the middleware required." **Accepted:** contracts carry no access information; the requirement is declared in the controller's middleware.

---

## The builder

**Q**: Shape of the middleware.

**A**: "Make it a heavily typed builder middleware that requires the `requireAuth` middleware before and then types the context more with its content. The mapping should as well be middleware handled, so mapping the input should be done in the builder." **Accepted:** `accessRequired(...)` typed after `requireAuth()`; `.on(...)` maps the input to the scope id; the context gains a typed `access` proof.

**Q**: What do the checks run on?

**A**: "The check should be done with services; I suppose these are the normal Effect services we use and not other typed services; I don't want to handle two different services for scope or things like that. The implementation of each scope and the check should be done as plugins and not as one factory." **Accepted:** checks are `Context.Service` tags provided by Layers; each scope kind and each condition is a plugin file; the owner provides `live`, other services provide `remote` of the same tag.

**Q**: Best DX for resource-oriented requirements (`ProjectRequirement.rules([...]).on().as()`, `UserRequirement.for()`).

**A**: "Find the best DX you can." **Accepted:** `defineResource(...)` gives `Service.can("deploy")`; `.on` inferred from the resource's id key; `.as` names; variadic `accessRequired(a, b)`; `anyOf`; `.onEach`; user-specific `.orSelf()` and `.notAbove()`; guardrails via `.requiring(...)`.

**Q**: Several requirements on one endpoint, and a gate inside the runtime (not a middleware) because other services are needed.

**A**: Accepted: sequence of requirements is AND, `anyOf` is OR, `onEach` for lists; and `accessDeferred(reason)` + `X.require(...)` inside the handler, with `Authorized<…>` proofs that service methods demand, plus a boundary check that a deferred procedure actually decided.

---

## The permission model

**Q**: Can roles stop being standalone in code and become assignable data, with everything gated on permissions and policies, including cases like "access to project B but not edit" and "can deploy but not edit"?

**A**: "The permission system should be really perfect; propose the best design." **Accepted:** code names only permissions; roles are data; one grant record (`subject, role|permission, scope, allow|deny, condition, expiry`); deny wins; conditions are data owned by plugins; guardrails stay in code; ranks are replaced by the subset rule; lock-out invariants and host recovery stay.

**Q**: Are some permissions per scope (`project:*`) and others platform-wide? Should the scope be inferred from the permission name?

**A**: Accepted: the catalog gives each resource a natural scope kind (and a per-action override such as `service:create` checked on the parent project); a controller supplies only the id.

---

## Topology

**Q**: Where does the code live and how does it run: only one microservice should hold the authorization data, not every service requesting the database for every resource.

**A**: Accepted: **identity is the single writer** of roles and grants; **every service decides in-process** from a cached snapshot; **resource data is read only by its owner**, other services use a `remote` scope resolver. Five flow diagrams were reviewed (overview, local request, foreign request, policy refresh, the decision) and are recorded in the design doc.

---

## Still open (not answered)

| Topic | Options | Recommendation |
|---|---|---|
| Snapshot source | fetch from identity, or read-only access to the authz tables with identity as single writer | read-only tables first, behind the `PermissionStore` port |
| Max snapshot staleness when identity is unreachable | N minutes, then deny all but public | not proposed yet |
| Epoch signal | poll or push | poll first |
| Does the platform `admin` get `deploy`? | yes or no | confirm the intent; one catalog line |
| Spike result: `.on` inference, `.as` records, authenticated-first typing in the BFF | verify (`AUTHZ-016`) | explicit `.on("key")` is the fallback |
| Better Auth admin plugin driven by grants | verify | needs a check before the `user.role` cut-over |
| Scope inheritance (project grant reaches its services) | `AUTHZ-053` | implement as part of the lineage walk |
