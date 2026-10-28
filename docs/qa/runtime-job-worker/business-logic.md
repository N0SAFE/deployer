# Q&A — Runtime job worker: business-logic

> **Module**: runtime-job-worker (EFF-202, DEPLOY-014..018)
> **Category**: business-logic
> **Last updated**: 2026-10-28

---

## Durability

**Q**: Today the deployment queue is in-memory (lost on restart, a lease-reaper timer, no real cancel). Persist it as a Postgres `deployment_jobs` table claimed with `FOR UPDATE SKIP LOCKED`?

**A**: Yes, Postgres table.

---

## Cancel

**Q**: What should cancelling a running deployment do?

**A**: Interrupt the job's fiber and kill its child processes; write the terminal `cancelled` state exactly once.

---

## Lease

**Q**: Lease defaults for a claimed job?

**A**: 60 s lease, renewed by a 15 s heartbeat; an expired lease is re-claimable.

---

## Scope

**Q**: How should it be staged?

**A**: Wire into the runtime now: replace the in-process queue (lifecycle + worker services) in the same change.

---
