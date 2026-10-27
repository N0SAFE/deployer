import { Injectable } from "@nestjs/common";
import type { DeploymentTriggerInput } from "@deployer/runtime-contracts/modules/deployment/crud";
import type { DeploymentTriggerEvent, DeploymentTriggerSource } from "./base/deployment-trigger-source.interface";

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
@Injectable()
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

    toTriggerInput(event: DeploymentTriggerEvent): Promise<DeploymentTriggerInput | null> {
        return Promise.resolve(this.cast(event.payload));
    }

    /**
     * The API body IS the trigger input; validate the two fields the seam depends on and
     * return null otherwise so `matches()` stays a cheap predicate.
     */
    private cast(payload: unknown): DeploymentTriggerInput | null {
        if (payload === null || typeof payload !== "object") return null;
        const candidate = payload as { serviceId?: unknown; source?: { sourceType?: unknown } | null };
        if (typeof candidate.serviceId !== "string" || candidate.serviceId.length === 0) return null;
        if (candidate.source === null || typeof candidate.source !== "object") return null;
        if (typeof candidate.source.sourceType !== "string") return null;
        // The contract's Zod schema validates the full shape at the oRPC boundary, so this
        // cast is narrowing to the already-validated object rather than inventing one.
        return payload as DeploymentTriggerInput;
    }
}
