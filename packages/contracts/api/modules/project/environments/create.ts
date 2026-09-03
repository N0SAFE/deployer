import z from "zod/v4";
import { standardDomainErrorContracts } from "@repo/orpc-utils";
import { environmentKindSchema, environmentTriggerSchema, environmentRulesSchema } from "@repo/contracts-entities";
import { projectEnvironmentOps } from "./shared";

/**
 * Create ANY environment as a first-class primitive:
 * free-form name + KIND (stable | preview | ephemeral) + per-env rules +
 * optional trigger (how preview/ephemeral envs are brought to life).
 */
export const projectCreateEnvironmentContract = projectEnvironmentOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/${p("id", b.entitySchema.shape.projectId)}/environments`)
            .body(
                z.object({
                    /** Free-form env name (production, qa, feat-x, perf-test…). */
                    name: z.string().min(1).max(100),
                    /** The primitive TYPE: stable | preview | ephemeral. */
                    kind: environmentKindSchema.default("stable"),
                    description: z.string().optional(),
                    /** Per-env rules (profiles, autoDeploy, strategy…). */
                    rules: environmentRulesSchema.optional(),
                    /** Trigger for preview/ephemeral envs (PR, branch, webhook…). */
                    trigger: environmentTriggerSchema.optional(),
                    domainConfig: b.entitySchema.shape.domainConfig.optional(),
                    deploymentConfig: b.entitySchema.shape.deploymentConfig.optional(),
                    metadata: b.entitySchema.shape.metadata.optional(),
                }),
            ),
    )
    .output((b) => b.entitySchema)
    .errors((e) => [
        // 404 for unknown project; 409 duplicate env name; 400 invalid kind/rules.
        ...standardDomainErrorContracts(e),
    ])
    .build();
