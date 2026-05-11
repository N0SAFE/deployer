import type { SetupInitializeInput, SetupInitializeResult } from "@repo/contracts-entities";

export interface EnvironmentSetupService {
    initialize(input: SetupInitializeInput): Promise<SetupInitializeResult>;
}
