import { Effect } from "effect";
import z from "zod/v4";

import type { DeploymentTriggerInput } from "@deployer/runtime-contracts/modules/deployment/crud";

import type { DeploymentTriggerEvent, DeploymentTriggerSource } from "./base/deployment-trigger-source.interface";

/** What the seam itself depends on: a service to deploy and a source that names its type. */
const apiTriggerSeamSchema = z.object({
    serviceId: z.string().min(1),
    source: z.object({ sourceType: z.string() }),
});

/**
 * The API-triggered source: an operator (or a script) POSTs a deployment.
 *
 * ── WHY THIS IS A SOURCE AND NOT JUST "the normal path" ──────────────────
 * It is the reference implementation of the seam. The API request already carries a
 * complete `DeploymentTriggerInput`, so this source's job is almost trivial — which is
 * the point: it proves a source can be a thin adapter, and it gives the registry a
 * source whose behaviour is unambiguous.
 *
 * `matches()` requires BOTH `provider === "api"` and a payload carrying `serviceId` and
 * `source`, so it cannot accidentally claim a webhook event.
 */
export class ApiTriggerSource implements DeploymentTriggerSource {
    readonly sourceId = "api";

    isEnabled(): boolean {
        return true;
    }

    disabledReason(): string {
        return "";
    }

    matches(event: DeploymentTriggerEvent): boolean {
        if (event.provider !== "api") return false;
        return this.cast(event.payload) !== null;
    }

    toTriggerInput(event: DeploymentTriggerEvent) {
        return Effect.succeed(this.cast(event.payload));
    }

    /**
     * The API body IS the trigger input; validate the two fields the seam depends on and
     * return null otherwise so `matches()` stays a cheap predicate.
     */
    private cast(payload: unknown): DeploymentTriggerInput | null {
        // The contract's schema validates the full shape at the oRPC boundary; this one names only what `matches()`
        // reads, so the predicate cannot claim an event whose payload lacks a service or a source type.
        const parsed = apiTriggerSeamSchema.safeParse(payload);
        return parsed.success ? (payload as DeploymentTriggerInput) : null;
    }
}
