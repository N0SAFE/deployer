import { EMPTY, type Observable, concat, defer, from, map, mergeMap } from "rxjs";
import { filter as rxFilter } from "rxjs/operators";
import { Effect } from "effect";
import type {
	ProjectStreamEvent,
	ProjectStreamQueryInput,
} from "@deployer/project-contracts/modules/project/stream";
import { DatabasePort } from "@project/core/database/database.port";
import { CoreEventSync } from "@project/core/ports/core-event-sync.port";
import { ProjectStore, type ProjectStoreShape } from "../repositories/project.repository";
import {
	ProjectEventService,
	type ProjectEventServiceImpl,
} from "./project-event.service";

/** Narrow a core envelope to a project stream event, dropping unknown names. */
function toProjectStreamEvent(
	envelope: {
		eventName: string;
		payload: unknown;
	} | null,
): ProjectStreamEvent | null {
	if (!envelope) return null;

	switch (envelope.eventName) {
		case "projectCreated":
		case "projectUpdated":
		case "projectDeleted":
		case "projectCollaboratorInvited":
		case "projectCollaboratorRemoved":
		case "projectEnvironmentCreated":
		case "projectEnvironmentDeleted":
			return {
				type: envelope.eventName,
				...(envelope.payload as object),
			} as ProjectStreamEvent;
		default:
			return null;
	}
}

/** Number the merged replay + live stream so consumers can order it. */
function toSequencedObservable<TEvent extends object>(input: {
	replay$: Observable<TEvent>;
	live$: Observable<TEvent>;
}): Observable<TEvent & { sequence: number; replayed: boolean; emittedAt: string }> {
	let sequence = 0;
	const stream$ = concat(
		input.replay$.pipe(map((event) => ({ event, replayed: true }))),
		input.live$.pipe(map((event) => ({ event, replayed: false }))),
	).pipe(
		map(({ event, replayed }) => {
			sequence += 1;
			return {
				...event,
				sequence,
				replayed,
				emittedAt: new Date().toISOString(),
			};
		}),
	);

	return stream$;
}

/** The stored projects that match the query, replayed as `projectCreated` events. */
function replayEvents(
	store: ProjectStoreShape,
	input: ProjectStreamQueryInput,
): Effect.Effect<ProjectStreamEvent[], Error, DatabasePort> {
	return Effect.gen(function* () {
		const list = yield* store.findMany({
			limit: input.replayLimit,
			offset: 0,
			filter: {
				...(input.projectId ? { id: { value: input.projectId, operator: "eq" as const } } : {}),
				...(input.ownerId ? { ownerId: { value: input.ownerId, operator: "eq" as const } } : {}),
				...(input.fuzzy ? { name: { value: input.fuzzy, operator: "ilike" as const } } : {}),
			},
			sortBy: "updatedAt",
			sortDirection: "desc",
		});

		let events = list.data.map((project) => ({
			type: "projectCreated" as const,
			projectId: project.id,
			ownerId: project.ownerId,
			name: project.name,
			timestamp: project.updatedAt,
		}));

		if (input.eventTypes && input.eventTypes.length > 0) {
			const accepted = new Set(input.eventTypes);
			events = events.filter((event) => accepted.has(event.type));
		}

		return events.slice(0, input.replayLimit);
	});
}

/** Map a core namespace definition to the stream query input it describes. */
export function toStreamQueryInput(
	definition: {
		scope: "global" | "tenant" | "project" | "service" | "deployment";
		scopeId: string | null;
		filters: Record<string, unknown> | null;
	},
	replay: boolean,
	replayLimit: number,
): ProjectStreamQueryInput {
	const filters = definition.filters ?? {};
	const scopedProjectId = definition.scope === "project" ? definition.scopeId ?? undefined : undefined;

	return {
		projectId: typeof filters.projectId === "string" ? filters.projectId : scopedProjectId,
		ownerId: typeof filters.ownerId === "string" ? filters.ownerId : undefined,
		eventTypes: Array.isArray(filters.eventTypes)
			? filters.eventTypes.filter((v): v is ProjectStreamEvent["type"] => typeof v === "string")
			: undefined,
		fuzzy: typeof filters.fuzzy === "string" ? filters.fuzzy : undefined,
		replay,
		replayLimit,
	};
}

/**
 * The project event stream, as an Effect.
 *
 * Both transports need it: the oRPC handler (request context) and the core
 * namespace adapter (app context, registered at boot). The replay read is
 * deferred until subscription, so the Effect context it captured at build time
 * is all it needs.
 */
export function streamProjectEvents(input: ProjectStreamQueryInput) {
	return Effect.gen(function* () {
		const coreEventSync = yield* CoreEventSync;
		const projectEvents = yield* ProjectEventService;
		const store = yield* ProjectStore;
		const database = yield* DatabasePort;

		let query = coreEventSync.selectMany({
			// The port exposes the emitter surface; `selectMany` needs the concrete
			// service object for its type-level contract map. They are the same Nest
			// instance (`useExisting`), so the cast is identity at runtime.
			service: projectEvents as unknown as ProjectEventServiceImpl,
			selections: [
				{ eventName: "projectCreated" },
				{ eventName: "projectUpdated" },
				{ eventName: "projectDeleted" },
				{ eventName: "projectCollaboratorInvited" },
				{ eventName: "projectCollaboratorRemoved" },
				{ eventName: "projectEnvironmentCreated" },
				{ eventName: "projectEnvironmentDeleted" },
			] as const,
		});

		if (input.eventTypes && input.eventTypes.length > 0) {
			const accepted = new Set(input.eventTypes);
			query = query.whereEventName((eventName) => accepted.has(eventName));
		}

		if (input.projectId) {
			query = query.wherePayload((payload) => {
				const value = payload as { projectId?: string };
				return value.projectId === input.projectId;
			});
		}

		if (input.ownerId) {
			query = query.wherePayload((payload) => {
				const value = payload as { ownerId?: string };
				return value.ownerId === input.ownerId;
			});
		}

		if (input.fuzzy) {
			query = query.whereFuzzy(input.fuzzy);
		}

		const live$ = query.execute().pipe(
			map((row) => toProjectStreamEvent(row.project)),
			rxFilter((event): event is ProjectStreamEvent => event !== null),
		);

		const replay$ = input.replay
			? defer(() =>
					from(
						Effect.runPromise(
							Effect.provideService(replayEvents(store, input), DatabasePort, database),
						),
					),
				).pipe(mergeMap((events) => from(events)))
			: EMPTY;

		return toSequencedObservable({ replay$, live$ });
	});
}
