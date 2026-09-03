import { Injectable, Inject, Logger } from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import type { DeploymentTriggerInput } from "@repo/api-contracts/modules/deployment/crud";
import type { DeploymentSourceCheckoutContext } from "../../base/source-provider.interface";
import { CodeProvider } from "./code-provider.interface";

@Injectable()
export class CodeProviderRegistryService implements OnModuleInit {
    private readonly logger = new Logger(CodeProviderRegistryService.name);
    private readonly providersByType = new Map<string, CodeProvider>();

    constructor(
        @Inject(CodeProvider) providers: CodeProvider[],
    ) {
        for (const provider of providers) {
            const key = provider.sourceType.toLowerCase();
            const existing = this.providersByType.get(key);
            if (existing) {
                this.logger.warn(
                    `CodeProvider '${key}' already registered by ${existing.constructor.name}, overwriting with ${provider.constructor.name}`,
                );
            }
            this.providersByType.set(key, provider);
        }
    }

    onModuleInit() {
        this.logger.log(
            `Code provider registry initialized: ${[...this.providersByType.keys()].join(", ")}`,
        );
    }

    /** Registered provider types (e.g. ["github", "upload", "custom"]). */
    listProviderTypes(): string[] {
        return [...this.providersByType.keys()];
    }

    /** Get the adapter for a source type, or null when unsupported. */
    getProvider(sourceType: string): CodeProvider | null {
        return this.providersByType.get(sourceType.toLowerCase()) ?? null;
    }

    // ─── Shared dispatch method ─────────────────────────────────────────────

    async resolveSourceCheckout(
        input: DeploymentTriggerInput,
    ): Promise<DeploymentSourceCheckoutContext | null> {
        const provider = this.getProvider(input.source.sourceType);
        if (!provider) {
            return null;
        }
        return provider.resolveSourceCheckout(input);
    }
}
