/**
 * CodeProvider — abstract contract for CODE source providers.
 *
 * THE abstract class IS BOTH the NestJS DI token AND the shared interface.
 * Concrete providers `extends CodeProvider` and are registered in the module
 * with `{ provide: CodeProvider, useClass: XxxSourceProviderService, multi: true }`.
 * The CodeProviderRegistryService injects all of them and dispatches by
 * `sourceType` through ONE shared method.
 */
import { Logger } from "@nestjs/common";
import type { DeploymentTriggerInput } from "@repo/api-contracts/modules/deployment/crud";
import type { DeploymentSourceCheckoutContext } from "../../base/source-provider.interface";

export abstract class CodeProvider {
    /** Dispatch key (lowercase): "github" | "gitlab" | "upload" | "custom" | ... */
    abstract readonly sourceType: string;

    /**
     * THE shared method: resolve a deployment trigger into a typed checkout
     * context. Returns null when this provider does not handle the trigger.
     */
    abstract resolveSourceCheckout(
        input: DeploymentTriggerInput,
    ): Promise<DeploymentSourceCheckoutContext | null>;

    // ─── Shared helpers (like v2's BaseProviderService) ─────────────────────

    protected readonly logger = new Logger("CodeProvider");

    /** True when the trigger targets this provider type. */
    protected matchesSourceType(input: DeploymentTriggerInput): boolean {
        return input.source.sourceType.toLowerCase() === this.sourceType.toLowerCase();
    }

    protected log(message: string, metadata?: Record<string, unknown>): void {
        if (metadata) {
            this.logger.log(`[${this.sourceType}] ${message} ${JSON.stringify(metadata)}`);
        } else {
            this.logger.log(`[${this.sourceType}] ${message}`);
        }
    }

    protected warn(message: string, error?: unknown): void {
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[${this.sourceType}] ${message}${error ? `: ${detail}` : ""}`);
    }
}
