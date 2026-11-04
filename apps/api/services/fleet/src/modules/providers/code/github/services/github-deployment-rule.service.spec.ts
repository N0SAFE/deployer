import { Cause, Effect, Exit } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { provideTo } from "@deployer/effect-core";

import { GithubDeploymentRules, type GithubDeploymentRulesShape } from "@/core/ports/github-deployment-rules.port";

import { GithubDeploymentRuleService } from "./github-deployment-rule.service";

const rule = (overrides: Record<string, unknown> = {}) => ({
    id: "r1",
    name: "main only",
    priority: 1,
    isActive: true,
    event: "pull_request",
    branchPattern: null,
    tagPattern: null,
    pathConditions: null,
    customCondition: null,
    action: "preview",
    deploymentStrategy: null,
    bypassCache: false,
    ...overrides,
});

describe("GithubDeploymentRuleService", () => {
    const findActiveByProjectId = vi.fn();
    // The fake needs nothing from the context beyond what is provided here.
    const service = provideTo(GithubDeploymentRuleService.live, (effect) =>
        effect.pipe(
            Effect.provideService(GithubDeploymentRules, { findActiveByProjectId } as unknown as GithubDeploymentRulesShape),
        ) as Effect.Effect<unknown>,
    );

    beforeEach(() => {
        vi.clearAllMocks();
        findActiveByProjectId.mockReturnValue(Effect.succeed([]));
    });

    it("defaults to deploy when no rule matches", async () => {
        const result = await Effect.runPromise(service.resolveAction({ projectId: "p1", event: "pull_request", branch: "main" }));
        expect(result).toEqual({ action: "deploy", reason: "no_rule_matched" });
        expect(findActiveByProjectId).toHaveBeenCalledWith("p1");
    });

    it("answers the first matching rule's action, with the rule that decided", async () => {
        findActiveByProjectId.mockReturnValue(Effect.succeed([rule({ id: "r2", name: "skip docs", action: "skip" }), rule()]));

        const result = await Effect.runPromise(service.resolveAction({ projectId: "p1", event: "pull_request", branch: "main" }));

        expect(result).toMatchObject({ action: "skip", reason: "rule:skip docs", rule: { id: "r2", name: "skip docs", bypassCache: false } });
    });

    it("ignores a rule written for another event", async () => {
        findActiveByProjectId.mockReturnValue(Effect.succeed([rule({ event: "push", action: "skip" })]));

        const result = await Effect.runPromise(service.resolveAction({ projectId: "p1", event: "pull_request", branch: "main" }));

        expect(result.action).toBe("deploy");
    });

    it("matches a branch by glob and by regex:, and not by another branch", async () => {
        findActiveByProjectId.mockReturnValue(Effect.succeed([rule({ branchPattern: "release/*", action: "skip" })]));
        expect((await Effect.runPromise(service.resolveAction({ projectId: "p1", event: "pull_request", branch: "release/1.0" }))).action).toBe("skip");
        expect((await Effect.runPromise(service.resolveAction({ projectId: "p1", event: "pull_request", branch: "feat/x" }))).action).toBe("deploy");

        findActiveByProjectId.mockReturnValue(Effect.succeed([rule({ branchPattern: "regex:^feat/", action: "skip" })]));
        expect((await Effect.runPromise(service.resolveAction({ projectId: "p1", event: "pull_request", branch: "feat/x" }))).action).toBe("skip");

        findActiveByProjectId.mockReturnValue(Effect.succeed([rule({ branchPattern: "regex:(", action: "skip" })]));
        expect((await Effect.runPromise(service.resolveAction({ projectId: "p1", event: "pull_request", branch: "feat/x" }))).action).toBe("deploy");
    });

    it("evaluates path conditions against the changed files", async () => {
        findActiveByProjectId.mockReturnValue(Effect.succeed([rule({ action: "skip", pathConditions: { include: ["docs/**"] } })]));

        const docsOnly = await Effect.runPromise(
            service.resolveAction({ projectId: "p1", event: "pull_request", branch: "main", changedFiles: ["docs/a.md"] }),
        );
        const code = await Effect.runPromise(
            service.resolveAction({ projectId: "p1", event: "pull_request", branch: "main", changedFiles: ["src/a.ts"] }),
        );

        expect(docsOnly.action).toBe("skip");
        expect(code.action).toBe("deploy");
    });

    it("lets the repository's failure through, for the host to translate", async () => {
        const failure = new Error("db down");
        findActiveByProjectId.mockReturnValue(Effect.fail(failure));

        const exit = await Effect.runPromiseExit(service.resolveAction({ projectId: "p1", event: "pull_request" }));

        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(failure);
    });
});
