# Deployment — Contracts Layer (Subagent 3/3)

## Contract Files
- 13 contract files in `packages/contracts/api/modules/deployment/`
- Total operations: ~130+ (CRUD + queue + state-machine + lifecycle + execution + plans)
- All contracts match API implementation in `apps/api/src/modules/deployment/`

## Operation Categories
- **CRUD**: list, findById, delete, trigger, uploadBundle, cancel, rollback, getLogs, retry, getRollbackHistory
- **Queue**: enqueue, claim, complete, fail, heartbeat, list, find, dead-letter (find, list, replay)
- **State Machine**: listPhaseTransitions, validatePhaseTransition, applyPhaseTransition
- **Lifecycle Events**: emit, list, stream
- **Execution**: cancel, resume, getCheckpoint
- **Plans**: createCompiledPlanSnapshot, get, list; compilePlan, compilePlanPreview, compileRollbackEdges
- **Template**: getTemplateProvenance, upsertTemplateProvenance
- **Retry Policy**: list, resolve
- **Streams**: stream, internalStream, serviceDeploymentsStream, queryStream, streamsList, streamFindById

## Entity Schemas
- `packages/contracts/entities/src/entities/deployment/` — 9 schema files
  - base, execution, lifecycle-events, phase, plan, provenance, queue, retry

## Gap Analysis
- ✅ All API module operations have contracts
- ✅ All contract operations have API implementations
- ✅ Entity schemas cover all deployment sub-domains

## Action Items
1. [S] No contract gaps — deployment is the most complete module
2. [M] Verify stream contracts validate output schema (critical ORPC rule — streams don't auto-validate per emission)
