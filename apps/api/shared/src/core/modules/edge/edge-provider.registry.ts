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

import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type {
	EdgeOptionField,
	EdgeOptions,
	EdgeProviderDescriptor,
	IngressLanes,
	PublicLane,
} from "@deployer/contracts-entities/entities/ingress/index";

import type { EdgeIngressPlan, EdgeProvider } from "./edge-provider";

/** What the ingress does when there is no public lane (or its provider is unknown). */
export const NO_PUBLIC_EDGE: EdgeIngressPlan = { publishedPorts: [], tls: "none" };

@Injectable()
export class EdgeProviderRegistry {
	private readonly logger = new Logger(EdgeProviderRegistry.name);
	private readonly providers = new Map<string, EdgeProvider>();

	register(provider: EdgeProvider): void {
		const { id } = provider.descriptor;
		if (this.providers.has(id)) throw new Error(`Edge provider '${id}' is registered twice`);
		this.providers.set(id, provider);
		this.logger.log(`Edge provider registered: ${id} (${provider.descriptor.kind})`);
	}

	/** Every registered provider's descriptor — the catalog the web renders. Tunnels first. */
	descriptors(): EdgeProviderDescriptor[] {
		return [...this.providers.values()]
			.map((provider) => provider.descriptor)
			.sort((a, b) => Number(a.opensInboundPorts) - Number(b.opensInboundPorts) || a.label.localeCompare(b.label));
	}

	find(id: string): EdgeProvider | null {
		return this.providers.get(id) ?? null;
	}

	get(id: string): EdgeProvider {
		const provider = this.find(id);
		if (provider === null) {
			throw new BadRequestException(`Unknown edge provider '${id}'. Available: ${[...this.providers.keys()].join(", ") || "none"}`);
		}
		return provider;
	}

	/** The provider behind the lanes' public lane, or null (no public lane / provider not registered). */
	active(lanes: IngressLanes): EdgeProvider | null {
		return lanes.public === null ? null : this.find(lanes.public.provider);
	}

	/**
	 * How Traefik must be exposed for these lanes.
	 *
	 * Ports are published ONLY with the operator's acknowledgement, whatever the
	 * provider asks for — the registry validated it on write, and this re-checks it
	 * on every read so a hand-edited setting cannot open a port by itself.
	 */
	ingressPlan(lanes: IngressLanes): EdgeIngressPlan {
		const provider = this.active(lanes);
		if (provider === null || lanes.public === null) return NO_PUBLIC_EDGE;
		const plan = provider.ingress(lanes.public);
		if (plan.publishedPorts.length > 0 && !lanes.public.acknowledgedInboundPorts) {
			this.logger.error(`Edge provider '${provider.descriptor.id}' asks for inbound ports without acknowledgement — none published`);
			return { ...plan, publishedPorts: [] };
		}
		return plan;
	}

	/** Validate and normalise a public lane against its provider. Throws `BadRequestException`. */
	normalize(lane: PublicLane): PublicLane {
		const provider = this.get(lane.provider);
		const { descriptor } = provider;
		const options = normalizeOptions(descriptor, lane.options);
		if (descriptor.opensInboundPorts && !lane.acknowledgedInboundPorts) {
			throw new BadRequestException(
				`${descriptor.label} opens inbound ports on every node. Set 'acknowledgedInboundPorts: true' to state that this is intended.`,
			);
		}
		const normalized: PublicLane = {
			...lane,
			acknowledgedInboundPorts: descriptor.opensInboundPorts && lane.acknowledgedInboundPorts,
			options,
		};
		provider.validate?.(normalized);
		return normalized;
	}

	/**
	 * DNS accounts the public lane depends on (its `dns-account` options).
	 *
	 * Lets a DNS provider refuse to delete an account the edge runs on without
	 * knowing which edge provider uses it.
	 */
	accountsInUse(lanes: IngressLanes): string[] {
		const provider = this.active(lanes);
		if (provider === null || lanes.public === null) return [];
		const { options } = lanes.public;
		return provider.descriptor.options.flatMap((field) => {
			const value = options[field.key];
			return field.type === "dns-account" && typeof value === "string" ? [value] : [];
		});
	}
}

function normalizeOptions(descriptor: EdgeProviderDescriptor, raw: EdgeOptions): EdgeOptions {
	const fields = new Map<string, EdgeOptionField>(descriptor.options.map((field) => [field.key, field]));
	const unknown = Object.keys(raw).filter((key) => !fields.has(key));
	if (unknown.length > 0) {
		throw new BadRequestException(`${descriptor.label} does not take option(s): ${unknown.join(", ")}`);
	}
	const options: EdgeOptions = {};
	for (const field of fields.values()) {
		const value = raw[field.key];
		if (field.type === "boolean") {
			if (value !== undefined && value !== null && typeof value !== "boolean") {
				throw new BadRequestException(`${descriptor.label}: '${field.key}' must be true or false`);
			}
			options[field.key] = typeof value === "boolean" ? value : field.defaultValue;
			continue;
		}
		const text = typeof value === "string" ? value.trim() : "";
		if (value !== undefined && value !== null && typeof value !== "string") {
			throw new BadRequestException(`${descriptor.label}: '${field.key}' must be text`);
		}
		if (text === "") {
			if (field.required) throw new BadRequestException(`${descriptor.label}: '${field.label}' is required`);
			options[field.key] = null;
			continue;
		}
		options[field.key] = text;
	}
	return options;
}
