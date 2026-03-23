import { BadRequestException, Injectable } from "@nestjs/common";
import { stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { DeploymentSourceCheckoutContext } from "../providers/base/source-provider.interface";
import { GitService } from "@/core/modules/git/git/services/git.service";
import { DockerService } from "@/core/modules/docker/services/docker.service";
import { DeploymentProviderBuilderRunnerStateMachineService } from "@/core/modules/deployment/services/deployment-provider-builder-runner-state-machine.service";

export type DeploymentBuilderKind =
    | "dockerfile"
    | "docker_compose"
    | "nixpacks"
    | "buildpack"
    | "railpack"
    | "external";

interface CliEnablement {
    node?: boolean;
    bun?: boolean;
    npm?: boolean;
    pnpm?: boolean;
    yarn?: boolean;
}

interface CustomCommandsConfig {
    cli?: CliEnablement;
    buildCommand?: string;
    runCommand?: string;
}

export interface BuildArtifactInput {
    deploymentId: string;
    serviceId: string;
    builder: DeploymentBuilderKind | null;
    sourceCheckout: DeploymentSourceCheckoutContext | null;
    fallbackContainerImage: string | null;
    customCommands?: CustomCommandsConfig | null;
}

@Injectable()
export class DeploymentArtifactBuilderService {
    constructor(
        private readonly gitService: GitService,
        private readonly dockerService: DockerService,
        private readonly deploymentStateMachineService: DeploymentProviderBuilderRunnerStateMachineService,
    ) {}

    async buildContainerizedArtifact(input: BuildArtifactInput): Promise<string | null> {
        const hasCustomCommands = this.hasCustomCommands(input.customCommands ?? null);
        const stateMachine = this.deploymentStateMachineService.evaluate({
            provider: this.resolveProviderKind(input.sourceCheckout),
            builder: input.builder,
            runner: null,
            hasContainerImage: Boolean(input.fallbackContainerImage?.trim()),
            hasCustomBuildCommand: Boolean(input.customCommands?.buildCommand?.trim()),
            hasCustomRunCommand: Boolean(input.customCommands?.runCommand?.trim()),
        });
        if (!stateMachine.canProceed) {
            throw new BadRequestException(stateMachine.violations.map((v) => v.message).join(" "));
        }

        const isCustomManagedBuilder = !input.builder && hasCustomCommands;
        const effectiveBuilder = stateMachine.normalizedBuilder;

        if (!effectiveBuilder) {
            return input.fallbackContainerImage;
        }

        if (effectiveBuilder === "external") {
            if (hasCustomCommands) {
                throw new BadRequestException(
                    "Custom build/run commands require a containerized builder and cannot be used with builder 'external'",
                );
            }
            if (!input.fallbackContainerImage || input.fallbackContainerImage.trim().length === 0) {
                throw new BadRequestException(
                    "Builder 'external' requires an explicit prebuilt container image",
                );
            }
            return input.fallbackContainerImage;
        }

        const sourceCheckout = input.sourceCheckout;
        if (sourceCheckout?.provider !== "upload") {
            throw new BadRequestException(
                `Builder '${effectiveBuilder}' currently supports upload source provider only`,
            );
        }

        if (!sourceCheckout.uploadPath?.trim()) {
            throw new BadRequestException("Upload source checkout must include uploadPath for build stage");
        }

        const uploadPath = sourceCheckout.uploadPath;
        const uploadStat = await stat(uploadPath);
        const buildContextPath = uploadStat.isFile()
            ? await this.gitService.extractUploadedFile({
                  filePath: uploadPath,
                  deploymentId: input.deploymentId,
              })
            : uploadPath;

        this.assertBuilderContextGuards(effectiveBuilder, buildContextPath, {
            allowDockerfileGuardBypass: isCustomManagedBuilder,
        });

        const customDockerfileName = await this.prepareCustomBuilderDockerfileIfNeeded({
            builder: effectiveBuilder,
            buildContextPath,
            customCommands: input.customCommands ?? null,
        });

        const imageTag = this.createImageTag({
            serviceId: input.serviceId,
            deploymentId: input.deploymentId,
            builder: effectiveBuilder,
        });

        await this.dockerService.buildImage(buildContextPath, imageTag, {
            ...(customDockerfileName ? { dockerfileName: customDockerfileName, autoCreateDockerfile: false } : {}),
        });
        return imageTag;
    }

    private hasCustomCommands(customCommands: CustomCommandsConfig | null): boolean {
        const buildCommand = customCommands?.buildCommand?.trim() ?? null;
        const runCommand = customCommands?.runCommand?.trim() ?? null;
        return buildCommand !== null || runCommand !== null;
    }

    private resolveProviderKind(sourceCheckout: DeploymentSourceCheckoutContext | null): "github" | "upload" | "custom" {
        if (!sourceCheckout) {
            return "upload";
        }
        if (sourceCheckout.provider === "github") {
            return "github";
        }
        if (sourceCheckout.provider === "custom") {
            return "custom";
        }
        return "upload";
    }

    private async prepareCustomBuilderDockerfileIfNeeded(input: {
        builder: DeploymentBuilderKind;
        buildContextPath: string;
        customCommands: CustomCommandsConfig | null | undefined;
    }): Promise<string | null> {
        const buildCommand = input.customCommands?.buildCommand?.trim();
        const runCommand = input.customCommands?.runCommand?.trim();

        if (!buildCommand && !runCommand) {
            return null;
        }

        this.assertCommandCliPolicy({
            buildCommand,
            runCommand,
            cli: input.customCommands?.cli,
        });

        const dockerfileName = "Dockerfile.deployer.custom";
        const dockerfilePath = path.join(input.buildContextPath, dockerfileName);
        const content = this.renderCustomBuilderDockerfile({
            builder: input.builder,
            buildCommand,
            runCommand,
            cli: input.customCommands?.cli,
        });
        await writeFile(dockerfilePath, content, "utf8");
        return dockerfileName;
    }

    private assertCommandCliPolicy(input: {
        buildCommand?: string;
        runCommand?: string;
        cli?: CliEnablement;
    }) {
        const combined = `${input.buildCommand ?? ""}\n${input.runCommand ?? ""}`;
        const normalized = combined.toLowerCase();
        const cli = input.cli ?? {};

        const expects = {
            bun: /(^|\s|&&|\|\|)bun(\s|$)/.test(normalized),
            node: /(^|\s|&&|\|\|)node(\s|$)/.test(normalized),
            npm: /(^|\s|&&|\|\|)npm(\s|$)/.test(normalized),
            pnpm: /(^|\s|&&|\|\|)pnpm(\s|$)/.test(normalized),
            yarn: /(^|\s|&&|\|\|)yarn(\s|$)/.test(normalized),
        };

        if (expects.bun && !cli.bun) {
            throw new BadRequestException("custom command uses 'bun' but execution.customCommands.cli.bun is disabled");
        }
        if (expects.node && !cli.node) {
            throw new BadRequestException("custom command uses 'node' but execution.customCommands.cli.node is disabled");
        }
        if (expects.npm && !cli.npm) {
            throw new BadRequestException("custom command uses 'npm' but execution.customCommands.cli.npm is disabled");
        }
        if (expects.pnpm && !cli.pnpm) {
            throw new BadRequestException("custom command uses 'pnpm' but execution.customCommands.cli.pnpm is disabled");
        }
        if (expects.yarn && !cli.yarn) {
            throw new BadRequestException("custom command uses 'yarn' but execution.customCommands.cli.yarn is disabled");
        }
    }

    private renderCustomBuilderDockerfile(input: {
        builder: DeploymentBuilderKind;
        buildCommand?: string;
        runCommand?: string;
        cli?: CliEnablement;
    }): string {
        const cli = input.cli ?? {};
        const buildCommand = input.buildCommand ?? "echo 'no custom build command provided'";
        const runCommand = input.runCommand ?? "npm start";

        const installLines = [
            "RUN apk add --no-cache bash curl git",
            ...(cli.node || cli.npm || cli.pnpm || cli.yarn ? ["RUN apk add --no-cache nodejs npm"] : []),
            ...(cli.bun
                ? [
                      "RUN curl -fsSL https://bun.sh/install | bash",
                      'ENV BUN_INSTALL="/root/.bun"',
                      'ENV PATH="$BUN_INSTALL/bin:$PATH"',
                  ]
                : []),
            ...(cli.pnpm ? ["RUN npm install -g pnpm"] : []),
            ...(cli.yarn ? ["RUN npm install -g yarn"] : []),
        ];

        return [
            "FROM alpine:3.20",
            "WORKDIR /app",
            ...installLines,
            "COPY . .",
            `RUN sh -lc ${JSON.stringify(buildCommand)}`,
            `CMD ["sh", "-lc", ${JSON.stringify(runCommand)}]`,
            `LABEL deployer.builder=${JSON.stringify(input.builder)}`,
        ].join("\n");
    }

    private assertBuilderContextGuards(
        builder: DeploymentBuilderKind,
        contextPath: string,
        options?: {
            allowDockerfileGuardBypass?: boolean;
        },
    ) {
        if (builder === "dockerfile") {
            if (options?.allowDockerfileGuardBypass) {
                return;
            }
            const dockerfilePath = path.join(contextPath, "Dockerfile");
            if (!existsSync(dockerfilePath)) {
                throw new BadRequestException(
                    "Builder 'dockerfile' requires a Dockerfile in upload context",
                );
            }
            return;
        }

        if (builder === "docker_compose") {
            const composeCandidates = [
                "docker-compose.yml",
                "docker-compose.yaml",
                "compose.yml",
                "compose.yaml",
            ];
            const hasCompose = composeCandidates.some((candidate) =>
                existsSync(path.join(contextPath, candidate)),
            );
            if (!hasCompose) {
                throw new BadRequestException(
                    "Builder 'docker_compose' requires a compose file in upload context",
                );
            }
            return;
        }

        // nixpacks/buildpack/railpack remain containerized via docker image build.
    }

    private createImageTag(input: {
        serviceId: string;
        deploymentId: string;
        builder: DeploymentBuilderKind;
    }): string {
        const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9_.-]/g, "-");
        const servicePart = normalize(input.serviceId).slice(0, 24);
        const deploymentPart = normalize(input.deploymentId).slice(0, 32);
        const builderPart = normalize(input.builder).slice(0, 24);
        return `deployer/${servicePart}:${deploymentPart}-${builderPart}`;
    }
}
