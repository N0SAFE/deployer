import { describe, expect, expectTypeOf, it } from "vitest";
import { ConfigurationDefinitionService } from "./configuration-definition.service";
import { ConfigurationResolverService } from "./configuration-resolver.service";
import type {
    RuntimeConfigurationResolverInputByScope,
    RuntimeEnvironmentMutationInput,
} from "../schemas/runtime-configuration.schema";

describe("ConfigurationResolverService", () => {
    const definitionService = new ConfigurationDefinitionService();
    const service = new ConfigurationResolverService(definitionService);

    it("exposes typed definitions for all scopes", () => {
        const definitions = service.listDefinitions();

        expect(definitions).toHaveLength(3);
        expect(definitions.map((d) => d.scope)).toEqual([
            "project",
            "service",
            "user",
        ]);
    });

    it("merges mesh/project/service/user layers with precedence", () => {
                const result = service.resolveStrict({
            scope: "service",
            context: {
                projectId: "proj-1",
                serviceId: "svc-1",
                requestedEnvironment: "production",
            },
            mesh: {
                deployment: {
                    defaultStrategy: "rolling",
                    enforceHttpsRedirect: true,
                    previewEnabled: true,
                },
                environment: { MESH_LEVEL: "1" },
                featureFlags: { meshFlag: true },
            },
            project: {
                settings: {
                    autoDeployEnabled: false,
                    deploymentStrategy: "canary",
                    defaultEnvironmentVariables: { PROJECT_DEFAULT: "1" },
                },
                environment: { PROJECT_LEVEL: "1" },
                featureFlags: { projectFlag: true },
            },
            service: {
                deployment: { strategy: "blue_green" },
                routing: { forceHttps: false, domains: ["svc.example.com"] },
                environment: { SERVICE_LEVEL: "1" },
                featureFlags: { serviceFlag: true },
            },
            user: {
                environmentOverrides: { USER_LEVEL: "1" },
                featureFlagOverrides: { userFlag: true },
                deployment: {},
            },
        });

        expect(result.effective.deployment.strategy).toBe("blue_green");
        expect(result.effective.deployment.autoDeployEnabled).toBe(false);
        expect(result.effective.routing.forceHttps).toBe(false);
        expect(result.effective.routing.domains).toEqual(["svc.example.com"]);

        expect(result.effective.environment).toMatchObject({
            MESH_LEVEL: "1",
            PROJECT_DEFAULT: "1",
            PROJECT_LEVEL: "1",
            SERVICE_LEVEL: "1",
            USER_LEVEL: "1",
        });

        expect(result.effective.featureFlags).toMatchObject({
            meshFlag: true,
            projectFlag: true,
            serviceFlag: true,
            userFlag: true,
        });
    });

    it("applies dynamic deployment constraints from requested environment", () => {
                const result = service.resolveStrict({
            scope: "project",
            context: {
                projectId: "proj-1",
                requestedEnvironment: "preview",
            },
            project: {
                settings: {
                    enablePreviewEnvironments: false,
                },
            },
        });

        expect(result.effective.deployment.previewEnabled).toBe(false);
        expect(result.effective.constraints.canDeployToRequestedEnvironment).toBe(false);
        expect(result.effective.constraints.reason).toContain("Preview deployments are disabled");
    });

    it("dispatches granular rules from multiple runtime inputs", () => {
                const result = service.resolveStrict({
            scope: "service",
            context: {
                projectId: "proj-1",
                serviceId: "svc-1",
                requestedEnvironment: "production",
                trigger: "webhook",
                sourceProvider: "github",
                actorRole: "developer",
                tags: ["high-risk", "urgent"],
                attributes: {
                    region: "eu-west-1",
                },
            },
            mesh: {
                deployment: {
                    defaultStrategy: "rolling",
                    enforceHttpsRedirect: true,
                    previewEnabled: true,
                },
            },
            service: {},
            dispatch: {
                rules: [
                    {
                        id: "tag-based-manual-approval",
                        priority: 10,
                        when: {
                            scopeIn: ["service"],
                            tagsAll: ["high-risk"],
                            sourceProviderIn: ["github"],
                            triggerIn: ["webhook"],
                        },
                        apply: {
                            deployment: {
                                requireApprovalForProduction: true,
                            },
                            featureFlagUpserts: {
                                strictApprovalFlow: true,
                            },
                        },
                    },
                    {
                        id: "dynamic-strategy-override",
                        priority: 20,
                        when: {
                            effectiveDeploymentStrategyIn: ["rolling"],
                            attributesEquals: {
                                region: "eu-west-1",
                            },
                        },
                        apply: {
                            deployment: {
                                strategy: "blue_green",
                            },
                            environmentUpserts: {
                                RELEASE_REGION: "eu-west-1",
                            },
                        },
                    },
                ],
            },
        });

        expect(result.effective.deployment.strategy).toBe("blue_green");
        expect(result.effective.deployment.requireApprovalForProduction).toBe(true);
        expect(result.effective.featureFlags.strictApprovalFlow).toBe(true);
        expect(result.effective.environment.RELEASE_REGION).toBe("eu-west-1");
        expect(result.dispatchAudit.appliedRuleIds).toEqual([
            "tag-based-manual-approval",
            "dynamic-strategy-override",
        ]);
    });

    it("resolves provider/runner/resources/replicas/traefik/lifecycle with constraints", () => {
                const result = service.resolveStrict({
            scope: "service",
            context: {
                projectId: "proj-1",
                serviceId: "svc-1",
                requestedEnvironment: "production",
                requestedProviderType: "github",
                requestedRunnerType: "docker",
                requestedReplicas: 3,
                requestedResources: {
                    cpuMillicores: 1400,
                    memoryMb: 1536,
                },
                requestedLifecycleState: "active",
                trigger: "manual",
            },
            mesh: {
                allowedProviders: ["github", "gitlab"],
                allowedRunners: ["docker", "buildpack"],
                projectLimits: {
                    cpuMillicores: 2000,
                    memoryMb: 2048,
                },
                maxProjectReplicas: 5,
                traefik: {
                    enabled: true,
                    entryPoints: ["websecure"],
                    tls: {
                        enabled: true,
                        resolver: "letsencrypt",
                    },
                },
            },
            project: {
                limits: {
                    cpuMillicores: 1500,
                    memoryMb: 1800,
                },
                maxReplicas: 4,
            },
            service: {
                replicas: {
                    min: 1,
                    desired: 2,
                    max: 4,
                },
                envPolicy: {
                    required: ["DATABASE_URL"],
                    denyList: ["FORBIDDEN_KEY"],
                },
                environment: {
                    DATABASE_URL: "postgres://db",
                },
                traefik: {
                    domains: ["api.example.com"],
                    middlewares: ["rate-limit"],
                },
            },
            dispatch: {
                rules: [
                    {
                        id: "production-force-bluegreen",
                        priority: 10,
                        when: {
                            requestedEnvironmentIn: ["production"],
                            requestedProviderTypeIn: ["github"],
                            requestedRunnerTypeIn: ["docker"],
                        },
                        apply: {
                            deployment: {
                                strategy: "blue_green",
                            },
                            replicas: {
                                desired: 4,
                            },
                            traefik: {
                                middlewares: ["rate-limit", "compression"],
                            },
                        },
                    },
                ],
            },
        });

        expect(result.effective.execution.providerType).toBe("github");
        expect(result.effective.execution.runnerType).toBe("docker");
        expect(result.effective.deployment.strategy).toBe("blue_green");
        expect(result.effective.replicas.desired).toBe(4);
        expect(result.effective.resources.cpuMillicores).toBe(1400);
        expect(result.effective.resources.memoryMb).toBe(1536);
        expect(result.effective.traefik.entryPoints).toEqual(["websecure"]);
        expect(result.effective.traefik.middlewares).toEqual([
            "rate-limit",
            "compression",
        ]);
        expect(result.effective.lifecycle.current).toBe("active");
        expect(result.effective.constraints.providerAllowed).toBe(true);
        expect(result.effective.constraints.runnerAllowed).toBe(true);
        expect(result.effective.constraints.replicasWithinLimits).toBe(true);
        expect(result.effective.constraints.resourcesWithinProjectLimits).toBe(true);
        expect(result.effective.constraints.envPolicyValid).toBe(true);
    });

    it("resolves environment by domain and flattens for runtime compatibility", () => {
                const result = service.resolveStrict({
            scope: "service",
            context: {
                        projectId: "proj-1",
                serviceId: "svc-1",
                requestedEnvironmentDomain: "runtime",
            },
            mesh: {
                environmentByDomain: {
                    build: { NODE_ENV: "production" },
                    security: { SECURITY_LEVEL: "mesh" },
                },
            },
            project: {
                environmentByDomain: {
                    runtime: { API_BASE_URL: "https://project.example.com" },
                },
            },
            service: {
                environmentByDomain: {
                    runtime: { SERVICE_MODE: "worker" },
                    provider: { PROVIDER_KIND: "github" },
                },
            },
            user: {
                environmentByDomainOverrides: {
                    runtime: { SERVICE_MODE: "api" },
                },
            },
        });

        expect(result.effective.environmentDomains.build.NODE_ENV).toBe("production");
        expect(result.effective.environmentDomains.runtime.API_BASE_URL).toBe(
            "https://project.example.com",
        );
        expect(result.effective.environmentDomains.runtime.SERVICE_MODE).toBe("api");
        expect(result.effective.environmentDomains.provider.PROVIDER_KIND).toBe("github");

        expect(result.effective.environment.NODE_ENV).toBe("production");
        expect(result.effective.environment.API_BASE_URL).toBe("https://project.example.com");
        expect(result.effective.environment.SERVICE_MODE).toBe("api");
        expect(result.effective.environment.PROVIDER_KIND).toBe("github");
    });

    it("applies discriminated environment mutations (flat + domain)", () => {
                const result = service.resolveStrict({
            scope: "service",
            context: {
                projectId: "proj-1",
                serviceId: "svc-1",
            },
            service: {
                environment: {
                    KEEP_ME: "1",
                    REMOVE_ME: "1",
                },
                environmentByDomain: {
                    runtime: {
                        RUNTIME_EXISTING: "1",
                    },
                },
            },
            dispatch: {
                rules: [
                    {
                        id: "env-mutations",
                        priority: 1,
                        apply: {
                            environmentMutations: [
                                {
                                    mode: "flat",
                                    upserts: { ADDED_FLAT: "1" },
                                    deletes: ["REMOVE_ME"],
                                },
                                {
                                    mode: "domain",
                                    domain: "runtime",
                                    upserts: { RUNTIME_ONLY: "2" },
                                    deletes: ["RUNTIME_EXISTING"],
                                },
                            ],
                        },
                    },
                ],
            },
        });

        expect(result.effective.environment.KEEP_ME).toBe("1");
        expect(result.effective.environment.REMOVE_ME).toBeUndefined();
        expect(result.effective.environment.ADDED_FLAT).toBe("1");
        expect(result.effective.environmentDomains.runtime.RUNTIME_EXISTING).toBeUndefined();
        expect(result.effective.environmentDomains.runtime.RUNTIME_ONLY).toBe("2");
        expect(result.effective.environment.RUNTIME_ONLY).toBe("2");
    });

    it("enforces scope-aware and discriminated typing at compile time", () => {
        const serviceInput: RuntimeConfigurationResolverInputByScope<"service"> = {
            scope: "service",
            context: {
                projectId: "proj-1",
                serviceId: "svc-1",
            },
            service: {
                environment: {
                    SERVICE_KEY: "value",
                },
            },
        };

        const mutation: RuntimeEnvironmentMutationInput = {
            mode: "domain",
            domain: "runtime",
            upserts: {
                API_URL: "https://example.com",
            },
        };

        expectTypeOf(serviceInput.context.serviceId).toEqualTypeOf<string>();
        expectTypeOf(mutation.mode).toEqualTypeOf<"domain">();
        expect(mutation.mode).toBe("domain");
    });
});
