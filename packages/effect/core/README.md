# @deployer/effect-core

Pure, runtime-agnostic Effect primitives shared by every Effect-native service (see `docs/audit-2026-10-25/effect-target-architecture.md`).

Currently: `fromAbortable(attempt, mapError)` - the only sanctioned way to lift a Promise API, so interrupting a fiber aborts the underlying work.

Planned (roadmap `EFF-160`): `domainError`/`ErrorKind`, `Actor`/`CurrentActor`/`Correlation`/`Ambient`, `IdGen`, `AssertNoLeak`.
