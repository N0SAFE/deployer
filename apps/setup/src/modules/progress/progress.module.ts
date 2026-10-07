import { Module } from "@nestjs/common";

import { EnvModule } from "@/config/env/env.module";
import { OrchestrationStreamService } from "./services/orchestration-stream.service";

/**
 * The setup app's progress timeline — the steps the operator watches.
 *
 * ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────────
 * The swarm phase, the API-start phase and the wizard all need to REPORT
 * progress, and the wizard also needs to READ it back to the browser. Putting
 * this in `wizard/` would have made `cluster/` import `wizard/`, which inverts
 * the stated direction (the wizard depends on the cluster, never the reverse)
 * and would have been a cycle the moment the gate — which lives in `wizard/` —
 * started the cluster.
 *
 * So the shared timeline lives BELOW all three: `cluster/`, `handover/` and
 * `wizard/` each depend on it, and it depends on none of them. It only knows
 * `EnvService` (to decide which steps a profile performs) and the contract's own
 * event types.
 *
 * `@Global()` is deliberately NOT used: three explicit imports are clearer than
 * an ambient provider, and the DI gate (`check-di-graph.ts`) reads the imports.
 */
@Module({
  imports: [EnvModule],
  providers: [OrchestrationStreamService],
  exports: [OrchestrationStreamService],
})
export class SetupProgressModule {}
