import type { SetupInitializeInput, SetupStateSnapshot } from "@repo/contracts-entities";

export interface SetupBootstrapResultBase {
    state: SetupStateSnapshot;
}

export abstract class SetupBootstrapBaseService<TResult extends SetupBootstrapResultBase> {
    abstract initialize(input: SetupInitializeInput): Promise<TResult>;

    protected buildCompletedState(strategy: "local_instance" | "remote_instance", hasUsers: boolean, hasOrganizations: boolean): SetupStateSnapshot {
        return {
            state: "completed",
            needsSetup: false,
            hasUsers,
            hasOrganizations,
            bootstrapStrategy: strategy,
            availableStrategies: ["local_instance", "remote_instance"],
            currentStep: null,
            progressPercent: 100,
            steps: [],
            completedAt: new Date(),
        };
    }
}