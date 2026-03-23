import { describe, expect, it } from "vitest";
import { DeploymentProviderBuilderRunnerStateMachineService } from "./deployment-provider-builder-runner-state-machine.service";

describe("DeploymentProviderBuilderRunnerStateMachineService", () => {
    const service = new DeploymentProviderBuilderRunnerStateMachineService();

    it("normalizes custom/docker-registry provider to external builder", () => {
        const result = service.evaluate({
            provider: "custom",
            builder: null,
            runner: "dockerfile",
            hasContainerImage: true,
            hasCustomBuildCommand: false,
            hasCustomRunCommand: false,
        });

        expect(result.canProceed).toBe(true);
        expect(result.normalizedBuilder).toBe("external");
    });

    it("rejects non-external builders for custom/docker-registry provider", () => {
        const result = service.evaluate({
            provider: "custom",
            builder: "nixpacks",
            runner: "dockerfile",
            hasContainerImage: true,
            hasCustomBuildCommand: false,
            hasCustomRunCommand: false,
        });

        expect(result.canProceed).toBe(false);
        expect(result.violations.some((violation) => violation.code === "CUSTOM_PROVIDER_BUILDER_MUST_BE_EXTERNAL")).toBe(true);
    });

    it("rejects custom commands for custom/docker-registry provider", () => {
        const result = service.evaluate({
            provider: "custom",
            builder: "external",
            runner: "dockerfile",
            hasContainerImage: true,
            hasCustomBuildCommand: true,
            hasCustomRunCommand: false,
        });

        expect(result.canProceed).toBe(false);
        expect(result.violations.some((violation) => violation.code === "CUSTOM_PROVIDER_NO_COMMAND_BUILD")).toBe(true);
    });

    it("accepts custom commands for managed builder strategies", () => {
        const result = service.evaluate({
            provider: "upload",
            builder: "nixpacks",
            runner: "docker",
            hasContainerImage: false,
            hasCustomBuildCommand: true,
            hasCustomRunCommand: true,
        });

        expect(result.canProceed).toBe(true);
        expect(result.normalizedBuilder).toBe("nixpacks");
    });

    it("rejects custom commands for user-managed dockerfile builder", () => {
        const result = service.evaluate({
            provider: "upload",
            builder: "dockerfile",
            runner: "docker",
            hasContainerImage: false,
            hasCustomBuildCommand: false,
            hasCustomRunCommand: true,
        });

        expect(result.canProceed).toBe(false);
        expect(result.violations.some((violation) => violation.code === "CUSTOM_COMMAND_UNSUPPORTED_BUILDER")).toBe(true);
    });

    it("supports scope-level override to allow custom-provider command execution", () => {
        const result = service.evaluate(
            {
                provider: "custom",
                builder: "external",
                runner: "dockerfile",
                hasContainerImage: true,
                hasCustomBuildCommand: true,
                hasCustomRunCommand: true,
            },
            {
                service: {
                    deployment: {
                        customProvider: {
                            allowCustomCommands: true,
                        },
                    },
                },
            },
        );

        expect(result.canProceed).toBe(false);
        expect(result.violations.some((violation) => violation.code === "CUSTOM_COMMAND_UNSUPPORTED_BUILDER")).toBe(true);
    });

    it("evaluates rollback transition strategy and blocks cross-environment rollback when configured", () => {
        const result = service.evaluateRollbackTransition(
            {
                sourceStatus: "failed",
                targetStatus: "success",
                sourceEnvironment: "preview",
                targetEnvironment: "production",
            },
            {
                service: {
                    rollback: {
                        allowCrossEnvironmentRollback: false,
                        strategyByEnvironment: {
                            preview: "canary",
                        },
                    },
                },
                runtime: {
                    deploymentStrategy: "blue_green",
                },
            },
        );

        expect(result.canProceed).toBe(false);
        expect(result.strategy).toBe("canary");
        expect(result.violations.some((violation) => violation.code === "ROLLBACK_CROSS_ENVIRONMENT_BLOCKED")).toBe(true);
    });

    it("evaluates preview operations against policy + resolved runtime flag", () => {
        const result = service.evaluatePreviewTransition(
            {
                operation: "create",
                environment: "preview",
                resolvedPreviewEnabled: false,
            },
            {
                project: {
                    preview: {
                        createEnabled: true,
                        allowedEnvironments: ["preview"],
                    },
                },
            },
        );

        expect(result.canProceed).toBe(false);
        expect(result.violations.some((violation) => violation.code === "PREVIEW_RUNTIME_FLAG_DISABLED")).toBe(true);
    });
});
