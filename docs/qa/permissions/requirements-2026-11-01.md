# Q&A — permissions: requirements (2026-11-01)

> **Module**: permissions  
> **Category**: business-logic / api-design / security  
> **Last updated**: 2026-11-01

---

## Direction

**Q**: What do you want the permission system to become?

**A**: Enhance the whole application's RBAC so it behaves like a real application permission system — low level — with role
and permission management available to super admins. Research the best permission model with the best DX, embed permission
management in Effect, and make it editable by users (super admins) rather than hardcoded.

**Q**: What does "editable" cover?

**A**: Super admins can manage roles and permissions (create custom roles, assign/revoke grants, manage who may do what),
from the application — not by editing code and redeploying.

**Q**: Where should the roadmap live?

**A**: Inside the audit folder (`docs/audit-2026-10-25/`), with the model research next to it.

## Follow-ups still open (blocking their phase, not this document)

Recorded as `§14 Decisions still needed` in [PERMISSIONS-ROADMAP.md](../../audit-2026-10-25/PERMISSIONS-ROADMAP.md):

1. Custom-role scope: platform-wide first, per-project later?
2. May a project owner delegate `deploy`/`dns` grants themselves?
3. Second-approver guardrail: opt-in, or mandatory for production?
4. Step-up window lengths.
5. The frozen public-procedure list.
