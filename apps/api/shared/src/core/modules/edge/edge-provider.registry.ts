/**
 * EdgeProviderRegistry — the set of edge providers this API can run the public lane on.
 *
 * Providers register themselves (see `edge-provider.ts`). The registry is the one
 * place a lane is checked against its provider, so every entry point — the Edge
 * page, a supervisor, a migration — applies the same rules:
 *
 *   1. the provider exists;
 *   2. the options match the descriptor's fields (types, required, no strangers),
 *      with boolean defaults filled in;
 *   3. a provider that opens inbound ports has the operator's acknowledgement;
 *   4. the provider's own `validate`.
 */

import { Context, Effect } from "effect";
import { Logger } from "@nestjs/common";

import type {
	EdgeOptionField,
	EdgeOptions,
	EdgeProviderDescriptor,
	IngressLanes,
	PublicLane,
} from "@deployer/contracts-entities/entities/ingress/index";

import { EdgeLaneInvalid, EdgeProviderAlreadyRegistered, EdgeProviderUnknown } from "./edge.errors";

import type { EdgeIngressPlan, EdgeProvider } from "./edge-provider";

/** What the ingress does when there is no public lane (or its provider is unknown). */
export const NO_PUBLIC_EDGE: EdgeIngressPlan = { publishedPorts: [], tls: "none" };

/**
 * The registry is process state (the plugin set), so it is built once. The reads are pure lookups and stay synchronous;
 * the two operations that can refuse (`get`, `normalize`) and `register` are Effects with tagged failures.
 */
export type EdgeProviderRegistryShape = {
	/** A provider registers itself once, at boot. */
	readonly register: (provider: EdgeProvider) => Effect.Effect<void, EdgeProviderAlreadyRegistered>;
	/** Every registered provider's descriptor: the catalog the web renders. Tunnels first. */
	readonly descriptors: () => EdgeProviderDescriptor[];
	readonly find: (id: string) => EdgeProvider | null;
	readonly get: (id: string) => Effect.Effect<EdgeProvider, EdgeProviderUnknown>;
	/** The provider behind the lanes' public lane, or null (no public lane / provider not registered). */
	readonly active: (lanes: IngressLanes) => EdgeProvider | null;
	/**
	 * How Traefik must be exposed for these lanes. Ports are published ONLY with the operator's acknowledgement, whatever the
	 * provider asks for: validated on write, and re-checked on every read so a hand-edited setting cannot open a port by itself.
	 */
	readonly ingressPlan: (lanes: IngressLanes) => EdgeIngressPlan;
	/** Validate and normalise a public lane against its provider. */
	readonly normalize: (lane: PublicLane) => Effect.Effect<PublicLane, EdgeProviderUnknown | EdgeLaneInvalid>;
	/** DNS accounts the public lane depends on (its `dns-account` options), so a DNS provider can refuse to delete one the edge runs on. */
	readonly accountsInUse: (lanes: IngressLanes) => string[];
};

export function makeEdgeProviderRegistry(): EdgeProviderRegistryShape {
	const logger = new Logger("EdgeProviderRegistry");
	const providers = new Map<string, EdgeProvider>();

	const find = (id: string): EdgeProvider | null => providers.get(id) ?? null;
	const get = (id: string): Effect.Effect<EdgeProvider, EdgeProviderUnknown> => {
		const provider = find(id);
		return provider === null ? Effect.fail(new EdgeProviderUnknown({ id, available: [...providers.keys()] })) : Effect.succeed(provider);
	};
	const active = (lanes: IngressLanes): EdgeProvider | null => (lanes.public === null ? null : find(lanes.public.provider));

	return {
		register: (provider) =>
			Effect.gen(function* () {
				const { id } = provider.descriptor;
				if (providers.has(id)) return yield* new EdgeProviderAlreadyRegistered({ id });
				providers.set(id, provider);
				yield* Effect.logInfo(`Edge provider registered: ${id} (${provider.descriptor.kind})`);
			}),

		descriptors: () =>
			[...providers.values()]
				.map((provider) => provider.descriptor)
				.sort((a, b) => Number(a.opensInboundPorts) - Number(b.opensInboundPorts) || a.label.localeCompare(b.label)),

		find,
		get,
		active,

		ingressPlan: (lanes) => {
			const provider = active(lanes);
			if (provider === null || lanes.public === null) return NO_PUBLIC_EDGE;
			const plan = provider.ingress(lanes.public);
			if (plan.publishedPorts.length > 0 && !lanes.public.acknowledgedInboundPorts) {
				logger.error(`Edge provider '${provider.descriptor.id}' asks for inbound ports without acknowledgement — none published`);
				return { ...plan, publishedPorts: [] };
			}
			return plan;
		},

		normalize: (lane) =>
			Effect.gen(function* () {
				const provider = yield* get(lane.provider);
				const { descriptor } = provider;
				const options = yield* normalizeOptions(descriptor, lane.options);
				if (descriptor.opensInboundPorts && !lane.acknowledgedInboundPorts) {
					return yield* new EdgeLaneInvalid({
						reason: `${descriptor.label} opens inbound ports on every node. Set 'acknowledgedInboundPorts: true' to state that this is intended.`,
					});
				}
				const normalized: PublicLane = {
					...lane,
					acknowledgedInboundPorts: descriptor.opensInboundPorts && lane.acknowledgedInboundPorts,
					options,
				};
				// A provider's own check refuses by throwing (its contract is plain code): that is an invalid lane.
				yield* Effect.try({
					try: () => provider.validate?.(normalized),
					catch: (cause) => new EdgeLaneInvalid({ reason: cause instanceof Error ? cause.message : String(cause), cause }),
				});
				return normalized;
			}),

		accountsInUse: (lanes) => {
			const provider = active(lanes);
			if (provider === null || lanes.public === null) return [];
			const { options } = lanes.public;
			return provider.descriptor.options.flatMap((field) => {
				const value = options[field.key];
				return field.type === "dns-account" && typeof value === "string" ? [value] : [];
			});
		},
	};
}

export class EdgeProviderRegistry extends Context.Service<EdgeProviderRegistry, EdgeProviderRegistryShape>()("shared/EdgeProviderRegistry") {}

function normalizeOptions(descriptor: EdgeProviderDescriptor, raw: EdgeOptions): Effect.Effect<EdgeOptions, EdgeLaneInvalid> {
	return Effect.gen(function* () {
		const fields = new Map<string, EdgeOptionField>(descriptor.options.map((field) => [field.key, field]));
		const unknown = Object.keys(raw).filter((key) => !fields.has(key));
		if (unknown.length > 0) {
			return yield* new EdgeLaneInvalid({ reason: `${descriptor.label} does not take option(s): ${unknown.join(", ")}` });
		}
		const options: EdgeOptions = {};
		for (const field of fields.values()) {
			const value = raw[field.key];
			if (field.type === "boolean") {
				if (value !== undefined && value !== null && typeof value !== "boolean") {
					return yield* new EdgeLaneInvalid({ reason: `${descriptor.label}: '${field.key}' must be true or false` });
				}
				options[field.key] = typeof value === "boolean" ? value : field.defaultValue;
				continue;
			}
			const text = typeof value === "string" ? value.trim() : "";
			if (value !== undefined && value !== null && typeof value !== "string") {
				return yield* new EdgeLaneInvalid({ reason: `${descriptor.label}: '${field.key}' must be text` });
			}
			if (text === "") {
				if (field.required) return yield* new EdgeLaneInvalid({ reason: `${descriptor.label}: '${field.label}' is required` });
				options[field.key] = null;
				continue;
			}
			options[field.key] = text;
		}
		return options;
	});
}
