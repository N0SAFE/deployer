import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import type { BuilderStrategy } from "./base/builder-strategy.interface";

/**
 * Multi-provider token for builder strategies.
 *
 * Mirrors `CodeProvider` / `DNS_PROVIDERS`: an array bound under one token so the
 * registry never names a concrete strategy.
 */
export const BUILDER_STRATEGIES = Symbol("BUILDER_STRATEGIES");

/**
 * BuilderRegistryService — the single public entry point for builder dispatch.
 *
 * ── THE CONTRACT ───────────────────────────────────────────────────────────
 * Callers ask for a builder kind and get either a strategy or a precise error. There
 * is no `if (builder === …)` anywhere outside a strategy itself, so adding nixpacks
 * (or a future "remote builder") means adding ONE class and ONE array entry in the
 * module.
 *
 * ── WHY `supportedBuilders()` EXISTS ──────────────────────────────────────
 * The catalog the web renders must come from HERE, not from a hand-written list.
 * That is the structural fix for the class of bug where the UI offered three builders
 * that always threw: a strategy that is registered but not `isAvailable()` is reported
 * as unavailable WITH its reason, so the option either disappears or is disabled
 * truthfully instead of failing at deploy time.
 */
@Injectable()
export class BuilderRegistryService implements OnModuleInit {
    private readonly logger = new Logger(BuilderRegistryService.name);
    private readonly byType = new Map<string, BuilderStrategy>();

    constructor(@Inject(BUILDER_STRATEGIES) strategies: BuilderStrategy[]) {
        for (const strategy of strategies) {
            const key = strategy.builderType.toLowerCase();
            const existing = this.byType.get(key);
            if (existing) {
                this.logger.warn(
                    `Builder '${key}' registered twice (${existing.constructor.name} → ${strategy.constructor.name}); the later one wins`,
                );
            }
            this.byType.set(key, strategy);
        }
    }

    onModuleInit(): void {
        const available = this.supportedBuilders()
            .filter((builder) => builder.available)
            .map((builder) => builder.builderType);
        this.logger.log(
            `Builder registry: ${available.length}/${String(this.byType.size)} available — ${available.join(", ")}`,
        );
    }

    /** Every registered builder, with availability, for the catalog / preflight. */
    supportedBuilders(): { builderType: string; available: boolean; reason: string | null }[] {
        return [...this.byType.values()].map((strategy) => ({
            builderType: strategy.builderType,
            available: strategy.isAvailable(),
            reason: strategy.isAvailable() ? null : strategy.unavailableReason(),
        }));
    }

    /**
     * Resolve a strategy, or throw with the reason it cannot be used.
     *
     * Distinguishes the two failure modes deliberately: "no such builder" (a caller
     * bug or a stale client) from "the builder exists but its toolchain is missing"
     * (an environment problem the operator can fix).
     */
    resolve(builderType: string): BuilderStrategy {
        const strategy = this.byType.get(builderType.toLowerCase());
        if (!strategy) {
            throw new BadRequestException(
                `Unsupported builder '${builderType}'. Supported: ${[...this.byType.keys()].join(", ")}`,
            );
        }
        if (!strategy.isAvailable()) {
            throw new BadRequestException(
                `Builder '${builderType}' is registered but unavailable: ${strategy.unavailableReason()}`,
            );
        }
        return strategy;
    }

    /** True when a builder is both registered AND runnable. */
    isSupported(builderType: string): boolean {
        const strategy = this.byType.get(builderType.toLowerCase());
        return strategy !== undefined && strategy.isAvailable();
    }
}
