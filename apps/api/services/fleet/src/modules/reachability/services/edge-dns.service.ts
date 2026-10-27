/**
 * EdgeDnsService — converges the DNS records the lanes need, through whichever DNS
 * provider account owns the zone.
 *
 * The record set for a lane name is owned by the lane: converging `*.<domain>`
 * means creating the planned contents and deleting any other A/AAAA/CNAME at that
 * exact name. When no configured provider owns the zone, the record is reported
 * as `manual` with exactly what to create — a missing provider is an operator
 * step, not an error.
 */

import { Context, Effect, Layer } from "effect";

import { attempt } from "../../../core/effects";
import type { DnsProviderAccountRef } from "@/modules/providers/dns/shared/dns-provider.interface";
import type { DnsProviderRegistryService } from "@/modules/providers/dns/shared/dns-provider-registry.service";
import { DnsProvidersPort } from "../reachability.ports";
import type { LaneDnsRecordPlan } from "./lane-dns-plan";

export type LaneDnsResult = {
	lane: LaneDnsRecordPlan["lane"];
	name: string;
	type: LaneDnsRecordPlan["type"];
	contents: string[];
	status: "synced" | "manual" | "error";
	detail: string | null;
};

/** The record types a lane name may carry; anything else at that name is left alone. */
const LANE_OWNED_TYPES = new Set(["A", "AAAA", "CNAME"]);

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Nothing here fails: each record reports its own outcome (`synced`, `manual`, `error`), because a
 * missing provider is an operator step and a provider outage must not abort the other records.
 */
export type EdgeDnsServiceShape = {
	/** Results of the last reconcile: what the Network pages show. */
	readonly results: () => Effect.Effect<LaneDnsResult[]>;
	/** Converge every planned record set. */
	readonly reconcile: (plans: readonly LaneDnsRecordPlan[]) => Effect.Effect<LaneDnsResult[]>;
	/** Remove the lane-owned records at `name` (e.g. after the edge moved to another domain). */
	readonly removeRecords: (name: string, preferredProviderId: string | null) => Effect.Effect<void>;
};

/** Tag and implementation together: the tag is the contract, `Live` the one implementation. */
export class EdgeDnsService extends Context.Service<EdgeDnsService, EdgeDnsServiceShape>()("fleet/EdgeDnsService") {
	/** Holds the last reconcile's results, so it is built once per runtime. */
	static readonly Live: Layer.Layer<EdgeDnsService, never, DnsProvidersPort> = Layer.effect(
		EdgeDnsService,
		Effect.gen(function* () {
			return makeEdgeDnsService(yield* DnsProvidersPort);
		}),
	);
}

export function makeEdgeDnsService(registry: DnsProviderRegistryService): EdgeDnsServiceShape {
	let lastResults: LaneDnsResult[] = [];

	/** Find the account + zone serving `hostname`, trying `preferred` first. */
	const locateZone = (hostname: string, preferred: string | null) =>
		Effect.gen(function* () {
			const accounts: DnsProviderAccountRef[] = [];
			for (const type of registry.listProviderTypes()) {
				accounts.push(...(yield* attempt(() => registry.listAccounts(type)).pipe(Effect.orElseSucceed(() => []))));
			}
			accounts.sort((a, b) => Number(b.providerId === preferred) - Number(a.providerId === preferred));
			for (const account of accounts) {
				const zone = yield* attempt(() => registry.findZoneForHostname(account, hostname)).pipe(
					Effect.orElseSucceed(() => null),
				);
				if (zone !== null) return { account, ...zone };
			}
			return null;
		});

	const reconcileOne = (plan: LaneDnsRecordPlan, preferred: string | null): Effect.Effect<LaneDnsResult> => {
		const base = { lane: plan.lane, name: plan.name, type: plan.type, contents: plan.contents };
		return Effect.gen(function* () {
			const zone = yield* locateZone(plan.name.replace(/^\*\./, ""), preferred);
			if (zone === null) {
				return {
					...base,
					status: "manual" as const,
					detail: `No configured DNS provider owns this zone — create ${plan.type} ${plan.name} → ${plan.contents.join(", ")} manually`,
				};
			}
			const existing = (yield* attempt(() => registry.listRecords(zone.account, zone.zoneId))).filter(
				(record) => record.name.toLowerCase() === plan.name.toLowerCase() && LANE_OWNED_TYPES.has(record.type),
			);
			for (const record of existing) {
				const keep = record.type === plan.type && plan.contents.includes(record.content) && record.proxied === plan.proxied;
				if (!keep) yield* attempt(() => registry.deleteRecord(zone.account, zone.zoneId, record.id));
			}
			const present = new Set(
				existing.filter((record) => record.type === plan.type && record.proxied === plan.proxied).map((record) => record.content),
			);
			for (const content of plan.contents) {
				if (present.has(content)) continue;
				yield* attempt(() =>
					registry.createRecord(zone.account, {
						zoneId: zone.zoneId,
						type: plan.type,
						name: plan.name,
						content,
						ttl: 1,
						proxied: plan.proxied,
					}),
				);
			}
			yield* Effect.logInfo(`DNS ${plan.type} ${plan.name} → ${plan.contents.join(", ")} (zone ${zone.zoneName})`);
			return { ...base, status: "synced" as const, detail: null };
		}).pipe(
			Effect.catch((error) => {
				const detail = describe(error);
				return Effect.logWarning(`DNS ${plan.type} ${plan.name} not converged: ${detail}`).pipe(
					Effect.as({ ...base, status: "error" as const, detail }),
				);
			}),
		);
	};

	return {
		results: () => Effect.sync(() => lastResults),

		reconcile: Effect.fn("EdgeDnsService.reconcile")(function* (plans) {
			const results: LaneDnsResult[] = [];
			for (const plan of plans) results.push(yield* reconcileOne(plan, plan.preferredAccountId));
			lastResults = results;
			return results;
		}),

		removeRecords: Effect.fn("EdgeDnsService.removeRecords")(function* (name, preferredProviderId) {
			yield* Effect.gen(function* () {
				const zone = yield* locateZone(name.replace(/^\*\./, ""), preferredProviderId);
				if (zone === null) return;
				const records = yield* attempt(() => registry.listRecords(zone.account, zone.zoneId));
				for (const record of records) {
					if (record.name.toLowerCase() === name.toLowerCase() && LANE_OWNED_TYPES.has(record.type)) {
						yield* attempt(() => registry.deleteRecord(zone.account, zone.zoneId, record.id));
					}
				}
			}).pipe(Effect.catch((error) => Effect.logWarning(`DNS cleanup of ${name} failed: ${describe(error)}`)));
		}),
	};
}
