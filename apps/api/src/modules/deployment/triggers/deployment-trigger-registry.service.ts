import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import type { DeploymentTriggerEvent, DeploymentTriggerSource } from "./base/deployment-trigger-source.interface";

/**
 * Multi-provider token for deployment trigger sources.
 *
 * Same convention as `BUILDER_STRATEGIES`, `RUNTIME_RUNNERS` and `DNS_PROVIDERS`: one
 * `Symbol` token bound to an array, because `@nestjs/common@11.2.7` does not declare
 * `multi` on `Provider`.
 */
export const DEPLOYMENT_TRIGGER_SOURCES = Symbol("DEPLOYMENT_TRIGGER_SOURCES");

/**
 * DeploymentTriggerRegistryService — the single public entry point for trigger dispatch.
 *
 * Ask it "which source owns this event?" and it answers with a source (or nothing), then
 * "what input does it produce?". Every origin — API, GitHub push, GitHub PR, a schedule —
 * is a `DeploymentTriggerSource`, so a new one is a file plus an array entry.
 *
 * ── WHY `resolve()` RETURNS NULL INSTEAD OF THROWING ──────────────────────
 * "No source matched" is a NORMAL outcome for a webhook endpoint, which receives every
 * event type the provider sends (issues, stars, releases…). Throwing would make a normal
 * delivery look like an error. `requireInput()` is the stricter form for callers that
 * genuinely expected a match.
 */
@Injectable()
export class DeploymentTriggerRegistryService implements OnModuleInit {
    private readonly logger = new Logger(DeploymentTriggerRegistryService.name);
    private readonly byId = new Map<string, DeploymentTriggerSource>();
    /** Registration order, preserved so dispatch is deterministic. */
    private readonly ordered: DeploymentTriggerSource[] = [];

    constructor(@Inject(DEPLOYMENT_TRIGGER_SOURCES) sources: DeploymentTriggerSource[]) {
        for (const source of sources) {
            const key = source.sourceId.toLowerCase();
            const existing = this.byId.get(key);
            if (existing) {
                this.logger.warn(
                    `Trigger source '${key}' registered twice (${existing.constructor.name} → ${source.constructor.name}); the later one wins`,
                );
                // Replace in place so `ordered` cannot hold two instances with one key.
                const index = this.ordered.indexOf(existing);
                if (index >= 0) this.ordered[index] = source;
            } else {
                this.ordered.push(source);
            }
            this.byId.set(key, source);
        }
    }

    onModuleInit(): void {
        const enabled = this.ordered.filter((source) => source.isEnabled()).map((s) => s.sourceId);
        this.logger.log(
            `Trigger sources: ${enabled.length}/${String(this.ordered.length)} enabled — ${enabled.join(", ")}`,
        );
        for (const source of this.ordered) {
            if (!source.isEnabled()) {
                this.logger.warn(`Trigger source '${source.sourceId}' is registered but disabled: ${source.disabledReason()}`);
            }
        }
    }

    /** Every registered source with its state, for the catalog / diagnostics. */
    supportedSources(): { sourceId: string; enabled: boolean; reason: string | null }[] {
        return this.ordered.map((source) => ({
            sourceId: source.sourceId,
            enabled: source.isEnabled(),
            reason: source.isEnabled() ? null : source.disabledReason(),
        }));
    }

    /** The first ENABLED source that claims this event, or null. */
    resolve(event: DeploymentTriggerEvent): DeploymentTriggerSource | null {
        for (const source of this.ordered) {
            // A disabled source must not claim an event: it would report "matched" and
            // then fail in `toTriggerInput`, which is a worse error than "no source".
            if (!source.isEnabled()) continue;
            if (source.matches(event)) return source;
        }
        return null;
    }

    /**
     * Resolve and translate in one step.
     *
     * Returns `null` when no source matched (a normal webhook delivery) and also when the
     * matched source declined to produce input (a well-formed event that is not
     * deployable, e.g. a PR from a fork).
     */
    async toTriggerInput(
        event: DeploymentTriggerEvent,
    ): Promise<{ sourceId: string; input: Awaited<ReturnType<DeploymentTriggerSource["toTriggerInput"]>> } | null> {
        const source = this.resolve(event);
        if (!source) return null;
        const input = await source.toTriggerInput(event);
        return { sourceId: source.sourceId, input };
    }

    /** Strict form: throws when nothing matched. For callers that expected a match. */
    async requireInput(event: DeploymentTriggerEvent): Promise<NonNullable<Awaited<ReturnType<DeploymentTriggerSource["toTriggerInput"]>>>> {
        const result = await this.toTriggerInput(event);
        if (!result || result.input === null) {
            throw new BadRequestException(
                `No deployment trigger source matched event '${event.provider}/${event.eventName}'. ` +
                    `Enabled sources: ${this.ordered.filter((s) => s.isEnabled()).map((s) => s.sourceId).join(", ")}`,
            );
        }
        return result.input;
    }
}
