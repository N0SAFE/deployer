import type { SupervisorState } from "../supervisor/state";

/** What happened to a supervisor. */
export type SupervisorEventType = "registered" | "state-changed" | "reconciled" | "health-snapshot" | "removed";

/** A supervisor lifecycle or health event. */
export type SupervisorEvent = {
	/** The supervisor that emitted it. */
	readonly supervisorId: string;
	readonly type: SupervisorEventType;
	/** ISO 8601 timestamp. */
	readonly at: string;
	/** Lifecycle state at emit time (state-changed, reconciled). */
	readonly state?: SupervisorState;
	/** Latest health (health-snapshot). */
	readonly healthy?: boolean;
	/** Human detail: a degradation reason, say. */
	readonly detail?: string | null;
};

/** Narrows a query by supervisor and/or event type. */
export type SupervisorEventFilter = {
	readonly supervisorId?: string;
	readonly type?: SupervisorEventType;
};

export const matchesEventFilter = (event: SupervisorEvent, filter: SupervisorEventFilter): boolean =>
	(filter.supervisorId === undefined || filter.supervisorId === event.supervisorId) &&
	(filter.type === undefined || filter.type === event.type);
