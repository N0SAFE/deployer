import type { SetupInitializeInput, SetupStateSnapshot } from "@repo/contracts-entities";

export interface SetupBootstrapResultBase {
    state: SetupStateSnapshot;
}

export abstract class SetupBootstrapBaseService<TResult extends SetupBootstrapResultBase> {
    abstract initialize(input: SetupInitializeInput): Promise<TResult>;

    protected buildCompletedState(strategy: "local" | "remote", hasUsers: boolean, hasOrganizations: boolean): SetupStateSnapshot {
        return {
            state: "completed",
            needsSetup: false,
            strategy,
            hasUsers,
            hasOrganizations,
            availableStrategies: ["local", "remote"],
            currentStep: null,
            progressPercent: 100,
            steps: [],
            completedAt: new Date(),
        };
    }
}