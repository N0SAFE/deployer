# Q&A — Step-up: Session identity

> **Module**: step-up (`AUTH-062`, feeds `AUTH-067`)
> **Category**: security
> **Last updated**: 2026-11-03

---

## How the request's session identity is threaded

**Q**: Step-up (`AUTH-062`) and impersonation (`AUTH-067`) both need the request's session identity, which `Actor` does
not carry today. How should it be threaded?

**A**: Extend `Actor` with `sessionId`.

**Consequence, as implemented**: the user variant of `Actor` (`@deployer/effect-core`) is
`{ kind: "user"; id; role; sessionId: string | null }`. `actorFromContext` fills it from
`context.auth.session.id`, i.e. the session Better Auth verified for the request. `null` means "no session identity"
(anonymous, mesh, system, a test) and a step-up refuses it rather than guessing.

---

## Which vertical comes next

**Q**: Which is the next vertical to build once the session identity is settled?

**A**: Step-up, then impersonation.
