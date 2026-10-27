import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import type { RuntimeExecutionInput, RuntimeExecutionResult } from "./runtime-runner.interface";

/**
 * Multi-provider token for runtime runners.
 *
 * Mirrors `BUILDER_STRATEGIES` and `DNS_PROVIDERS`: an array bound under one token so the
 * registry never names a concrete runner. Adding a Kubernetes or Nomad runner is one
 * class + one array entry.
 */
export const RUNTIME_RUNNERS = Symbol("RUNTIME_RUNNERS");

/**
 * The contract every runner implements.
 *
 * `runnerType` is the dispatch key and `executeRuntime` is the ONE shared method — both
 * already existed on the seven concrete runners. What was missing was the collection
 * token, so the registry had to name them as seven constructor parameters AND repeat the
 * list as an array literal.
 */
export interface RuntimeRunner {
    readonly runnerType: string;
    executeRuntime(input: RuntimeExecutionInput): Promise<RuntimeExecutionResult>;
}

@Injectable()
export class RuntimeRunnerRegistryService implements OnModuleInit {
    private readonly logger = new Logger(RuntimeRunnerRegistryService.name);
    private readonly byType = new Map<string, RuntimeRunner>();

    /**
     * ── WHY THIS IS NOW A COLLECTION ────────────────────────────────────
     * It used to be seven named parameters, re-declared as a hardcoded array below:
     *
     *   constructor(docker, dockerfile, compose, nixpacks, buildpack, railpack, swarm) {}
     *   const runners = [this.dockerRuntimeRunnerService, … ];   // the same seven again
     *
     * So adding a runner meant editing three places in this file (parameter, field,
     * array) — and the old comment argued the seven were "REQUIRED" so they could not be
     * optional. That reasoning optimised for DI failure over extensibility: a collection
     * token keeps the boot-time guarantee (a missing provider still fails at boot, because
     * the array is injected) while removing the edit.
     */
    constructor(@Inject(RUNTIME_RUNNERS) runners: RuntimeRunner[]) {
        for (const runner of runners) {
            const key = runner.runnerType.toLowerCase();
            const existing = this.byType.get(key);
            if (existing) {
                this.logger.warn(
                    `Runner '${key}' registered twice (${existing.constructor.name} → ${runner.constructor.name}); the later one wins`,
                );
            }
            this.byType.set(key, runner);
        }
    }

    onModuleInit(): void {
        this.logger.log(`Runner registry: ${[...this.byType.keys()].join(", ")}`);
    }

    /** Registered runner types, for the catalog / preflight. */
    supportedRunners(): string[] {
        return [...this.byType.keys()];
    }

    async execute(
        runnerKind: string | null | undefined,
        input: RuntimeExecutionInput,
    ): Promise<RuntimeExecutionResult> {
        const normalized = (runnerKind ?? "docker").toLowerCase();
        const runner = this.byType.get(normalized);

        if (!runner) {
            // Distinguishes "no such runner" (caller bug / stale client) from a runner
            // that exists but could not be constructed — the latter would already have
            // failed at boot, which is the point of injecting the collection.
            throw new BadRequestException(
                `Unsupported runtime runner '${normalized}'. Supported: ${[...this.byType.keys()].join(", ")}`,
            );
        }

        return runner.executeRuntime(input);
    }
}

