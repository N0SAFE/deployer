import { describe, expect, it } from "vitest";
import { ConfigurationStateMachineBuilderService } from "./configuration-state-machine-builder.service";

describe("ConfigurationStateMachineBuilderService", () => {
    const service = new ConfigurationStateMachineBuilderService();

    it("builds typed state-machine definitions with dependencies, transitions, and rules", () => {
        const machine = service
            .create()
            .defineNode({
                scope: "project",
                lifecycleState: "active",
                dependsOnScopes: [],
                allowedProviderTypes: ["github", "gitlab"],
                allowedRunnerTypes: ["docker", "buildpack"],
            })
            .defineTransition({
                from: "active",
                to: "locked",
                when: {
                    scopeIn: ["project"],
                },
                description: "lock when project policy enters compliance freeze",
            })
            .defineRule({
                id: "production-hardening",
                priority: 100,
                when: {
                    requestedEnvironmentIn: ["production"],
                    requestedProviderTypeIn: ["github"],
                },
                apply: {
                    deployment: {
                        requireApprovalForProduction: true,
                    },
                    resources: {
                        cpuMillicores: 1000,
                    },
                },
            })
            .build();

        expect(machine.nodes).toHaveLength(1);
        expect(machine.transitions).toHaveLength(1);
        expect(machine.dispatch.rules).toHaveLength(1);
        expect(machine.dispatch.rules[0]?.id).toBe("production-hardening");
    });

    it("supports fluent policy DSL for constraints and dependencies", () => {
        const machine = service
            .policy()
            .node("service", "active")
            .describe("service runtime policy")
            .dependsOn("project")
            .allowProviders("github")
            .allowRunners("docker")
            .done()
            .transition("active", "locked")
            .describe("freeze deployments when required")
            .when({
                scopeIn: ["service"],
                requestedEnvironmentIn: ["production"],
            })
            .done()
            .rule("prod-guard")
            .priority(200)
            .whenScope("service")
            .whenEnvironment("production")
            .apply({
                deployment: {
                    requireApprovalForProduction: true,
                },
            })
            .constrain({
                canDeployToRequestedEnvironment: true,
                providerAllowed: true,
                runnerAllowed: true,
                lifecycleTransitionAllowed: true,
                replicasWithinLimits: true,
                resourcesWithinProjectLimits: true,
                envPolicyValid: true,
            })
            .done()
            .build();

        expect(machine.nodes).toHaveLength(1);
        expect(machine.nodes[0]?.dependsOnScopes).toEqual(["project"]);
        expect(machine.transitions[0]?.from).toBe("active");
        expect(machine.dispatch.rules[0]?.id).toBe("prod-guard");
        expect(machine.dispatch.rules[0]?.priority).toBe(200);
        expect(machine.dispatch.rules[0]?.when.scopeIn).toEqual(["service"]);
    });
});
