import { Injectable } from "@nestjs/common";
import type { DeploymentTriggerInput } from "@repo/api-contracts/modules/deployment/crud";
import type {
    DeploymentSourceCheckoutContext,
    DeploymentSourceProvider,
} from "./base/source-provider.interface";

@Injectable()
export class SourceProviderRegistryService {
    private readonly providersByType: Map<string, DeploymentSourceProvider>;

    constructor(
        private readonly providers: DeploymentSourceProvider[],
    ) {
        this.providersByType = new Map(
            providers.map((provider) => [provider.sourceType.toLowerCase(), provider]),
        );
    }

    async resolveSourceCheckout(
        input: DeploymentTriggerInput,
    ): Promise<DeploymentSourceCheckoutContext | null> {
        const sourceType = input.sourceType.toLowerCase();
        const provider = this.providersByType.get(sourceType);
        if (!provider) {
            return null;
        }

        return provider.resolveSourceCheckout(input);
    }
}
