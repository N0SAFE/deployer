import { domainError } from "@deployer/effect-core";

/** The environment does not satisfy the schema; `issues` lists each invalid variable and why. */
export class EnvironmentInvalid extends domainError("EnvironmentInvalid", "validation")<{
	readonly issues: readonly { readonly variable: string; readonly message: string }[];
}>() {
	override publicMessage() {
		return `Invalid environment: ${this.issues.map((issue) => `${issue.variable} (${issue.message})`).join(", ")}`;
	}
}
