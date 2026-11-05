import { domainError } from "@deployer/effect-core";

/** The runtime configuration could not be resolved: the input (or the resolved result) broke its schema. `issues` names every violation. */
export class RuntimeConfigurationInvalid extends domainError("RuntimeConfigurationInvalid", "validation")<{
    readonly stage: "input" | "output";
    readonly issues: string;
}>() {
    override publicMessage() {
        return `The runtime configuration is invalid (${this.stage}): ${this.issues}`;
    }
}

/** A state machine definition does not satisfy its schema. */
export class RuntimeConfigurationStateMachineInvalid extends domainError("RuntimeConfigurationStateMachineInvalid", "validation")<{
    readonly issues: string;
}>() {
    override publicMessage() {
        return `The runtime configuration state machine is invalid: ${this.issues}`;
    }
}
