import { domainError } from "@deployer/effect-core";

/** No core event stream definition has this id. */
export class CoreEventStreamNotFound extends domainError("CoreEventStreamNotFound", "not_found")<{ readonly id: string }>() {
	override publicMessage() { return `Core event stream definition with id '${this.id}' not found`; }
}

/** The stream definition exists but is switched off. */
export class CoreEventStreamInactive extends domainError("CoreEventStreamInactive", "validation")<{ readonly id: string }>() {
	override publicMessage() { return `Core event stream '${this.id}' is inactive`; }
}

/** Nothing registered an adapter for the stream's namespace. */
export class CoreEventNamespaceUnregistered extends domainError("CoreEventNamespaceUnregistered", "validation")<{ readonly namespace: string }>() {
	override publicMessage() { return `No core event namespace adapter registered for '${this.namespace}'`; }
}

/** A namespace was declared with neither an adapter nor an event service. */
export class CoreEventNamespaceMisconfigured extends domainError("CoreEventNamespaceMisconfigured", "validation")<{ readonly namespace: string }>() {
	override publicMessage() { return `No adapter or event service configured for namespace '${this.namespace}'`; }
}

/** A stream's filters cannot name a subscription (`eventName` string + `input` object are required without a custom resolver). */
export class CoreEventStreamFiltersInvalid extends domainError("CoreEventStreamFiltersInvalid", "validation")() {
	override publicMessage() {
		return "Core stream filters must include 'eventName' (string) and 'input' (object) when using registerNamespaceEventService without a custom resolver";
	}
}

/** An adapter's stream failed while its events were being collected; the cause stays server-side. */
export class CoreEventCollectionFailed extends domainError("CoreEventCollectionFailed", "dependency_missing")() {
	override publicMessage() { return "The event stream could not be read."; }
}
