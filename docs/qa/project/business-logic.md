# Q&A — Project Service: Migration Scope

> **Module**: project (svc-project)
> **Category**: business-logic
> **Last updated**: 2026-10-26

---

## Which service is migrated next

**Q**: Which service app is migrated next to the Effect pattern (shape → tag → impl, `createModuleContext`, `.effect` controllers)?

**A**: `project`.

---

## Scope of the pass

**Q**: Scope for this pass?

**A**: Whole service, module by module — `modules/project`, `modules/service`, `modules/domain`, plus the app wiring.

---

## Behaviour

**Q**: Parity or upgrade while migrating?

**A**: Upgrade aggressively. Behaviour changes are allowed where the current code is wrong, and every change is listed in the report.

---
