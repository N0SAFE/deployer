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

import { Injectable, Logger } from "@nestjs/common";

import { DnsProviderRegistryService } from "@/modules/providers/dns/shared/dns-provider-registry.service";
import type { DnsProviderAccountRef } from "@/modules/providers/dns/shared/dns-provider.interface";

import type { LaneDnsRecordPlan } from "./lane-dns-plan";

export interface LaneDnsResult {
	lane: LaneDnsRecordPlan["lane"];
	name: string;
	type: LaneDnsRecordPlan["type"];
	contents: string[];
	status: "synced" | "manual" | "error";
	detail: string | null;
}

/** The record types a lane name may carry; anything else at that name is left alone. */
const LANE_OWNED_TYPES = new Set(["A", "AAAA", "CNAME"]);

@Injectable()
export class EdgeDnsService {
	private readonly logger = new Logger(EdgeDnsService.name);
	private lastResults: LaneDnsResult[] = [];

	constructor(private readonly registry: DnsProviderRegistryService) {}

	/** Results of the last reconcile — what the Network pages show. */
	results(): LaneDnsResult[] {
		return this.lastResults;
	}

	/** Find the account + zone serving `hostname`, trying `preferred` first. */
	private async locateZone(
		hostname: string,
		preferred: string | null,
	): Promise<{ account: DnsProviderAccountRef; zoneId: string; zoneName: string } | null> {
		const accounts: DnsProviderAccountRef[] = [];
		for (const type of this.registry.listProviderTypes()) {
			accounts.push(...(await this.registry.listAccounts(type).catch(() => [])));
		}
		accounts.sort((a, b) => Number(b.providerId === preferred) - Number(a.providerId === preferred));
		for (const account of accounts) {
			const zone = await this.registry.findZoneForHostname(account, hostname).catch(() => null);
			if (zone !== null) return { account, ...zone };
		}
		return null;
	}

	/** Converge every planned record set. Never throws; each record reports its own outcome. */
	async reconcile(plans: readonly LaneDnsRecordPlan[]): Promise<LaneDnsResult[]> {
		const results: LaneDnsResult[] = [];
		for (const plan of plans) results.push(await this.reconcileOne(plan, plan.preferredAccountId));
		this.lastResults = results;
		return results;
	}

	private async reconcileOne(plan: LaneDnsRecordPlan, preferred: string | null): Promise<LaneDnsResult> {
		const base = { lane: plan.lane, name: plan.name, type: plan.type, contents: plan.contents };
		try {
			const zone = await this.locateZone(plan.name.replace(/^\*\./, ""), preferred);
			if (zone === null) {
				return {
					...base,
					status: "manual",
					detail: `No configured DNS provider owns this zone — create ${plan.type} ${plan.name} → ${plan.contents.join(", ")} manually`,
				};
			}
			const existing = (await this.registry.listRecords(zone.account, zone.zoneId)).filter(
				(record) => record.name.toLowerCase() === plan.name.toLowerCase() && LANE_OWNED_TYPES.has(record.type),
			);
			for (const record of existing) {
				const keep = record.type === plan.type && plan.contents.includes(record.content) && record.proxied === plan.proxied;
				if (!keep) await this.registry.deleteRecord(zone.account, zone.zoneId, record.id);
			}
			const present = new Set(
				existing.filter((record) => record.type === plan.type && record.proxied === plan.proxied).map((record) => record.content),
			);
			for (const content of plan.contents) {
				if (present.has(content)) continue;
				await this.registry.createRecord(zone.account, {
					zoneId: zone.zoneId,
					type: plan.type,
					name: plan.name,
					content,
					ttl: 1,
					proxied: plan.proxied,
				});
			}
			this.logger.log(`DNS ${plan.type} ${plan.name} → ${plan.contents.join(", ")} (zone ${zone.zoneName})`);
			return { ...base, status: "synced", detail: null };
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this.logger.warn(`DNS ${plan.type} ${plan.name} not converged: ${detail}`);
			return { ...base, status: "error", detail };
		}
	}

	/** Remove the lane-owned records at `name` (e.g. after the edge moved to another domain). */
	async removeRecords(name: string, preferredProviderId: string | null): Promise<void> {
		try {
			const zone = await this.locateZone(name.replace(/^\*\./, ""), preferredProviderId);
			if (zone === null) return;
			const records = await this.registry.listRecords(zone.account, zone.zoneId);
			for (const record of records) {
				if (record.name.toLowerCase() === name.toLowerCase() && LANE_OWNED_TYPES.has(record.type)) {
					await this.registry.deleteRecord(zone.account, zone.zoneId, record.id);
				}
			}
		} catch (error) {
			this.logger.warn(`DNS cleanup of ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}
