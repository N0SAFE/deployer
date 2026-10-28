import { domainError } from "@deployer/effect-core";

/** The event log could not be read or written; `cause` is the driver's own error. */
export class EventLogUnavailable extends domainError("EventLogUnavailable", "dependency_missing")<{
	readonly reason: string;
}>() {
	override publicMessage() {
		return this.reason;
	}
}
