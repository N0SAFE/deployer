import type { ConfigSchema } from "@deployer/provider-schema/domain/index";

export const builderSchemasCatalog: Record<string, ConfigSchema> = {
    dockerfile: {
        id: "dockerfile",
        version: "1.0.0",
        title: "Dockerfile Builder Configuration",
        description: "Configure docker build behavior",
        fields: [
            {
                key: "dockerfilePath",
                label: "Dockerfile Path",
                type: "text",
                required: false,
                defaultValue: "Dockerfile",
                schema: { type: "string" },
                ui: { order: 1 },
            },
            {
                key: "buildArgs",
                label: "Build Arguments",
                type: "json",
                required: false,
                defaultValue: {},
                schema: { type: "object" },
                ui: { order: 2, fullWidth: true },
            },
        ],
    },
    nixpacks: {
        id: "nixpacks",
        version: "1.0.0",
        title: "Nixpacks Builder Configuration",
        description: "Configure Nixpacks build strategy",
        fields: [
            {
                key: "installCommand",
                label: "Install Command",
                type: "text",
                required: false,
                schema: { type: "string" },
                ui: { order: 1 },
            },
            {
                key: "buildCommand",
                label: "Build Command",
                type: "text",
                required: false,
                schema: { type: "string" },
                ui: { order: 2 },
            },
        ],
    },
    // `static` used to live here. It was not a builder — no strategy registers it and
    // `deploymentBuilderKindSchema` rejects it — so its config schema documented a
    // feature that could never run. Replaced by the four builders that DO exist.
    docker_compose: {
        id: "docker_compose",
        version: "1.0.0",
        title: "Docker Compose Builder Configuration",
        description: "Choose the compose file and the service to deploy",
        fields: [
            {
                key: "composeFile",
                label: "Compose File",
                type: "text",
                required: false,
                defaultValue: "docker-compose.yml",
                schema: { type: "string" },
                ui: { order: 1 },
            },
            {
                key: "serviceName",
                label: "Compose Service",
                type: "text",
                required: false,
                schema: { type: "string" },
                ui: { order: 2 },
            },
        ],
    },
    buildpack: {
        id: "buildpack",
        version: "1.0.0",
        title: "Buildpacks Configuration",
        description: "Custom builder image plus build and run commands",
        fields: [
            {
                key: "buildpackBuilder",
                label: "Builder Image",
                type: "text",
                required: false,
                defaultValue: "paketobuildpacks/builder-jammy-base",
                schema: { type: "string" },
                ui: { order: 1 },
            },
            {
                key: "buildCommand",
                label: "Build Command",
                type: "text",
                required: true,
                schema: { type: "string", minLength: 1 },
                ui: { order: 2 },
            },
            {
                key: "startCommand",
                label: "Start Command",
                type: "text",
                required: true,
                schema: { type: "string", minLength: 1 },
                ui: { order: 3 },
            },
        ],
    },
    railpack: {
        id: "railpack",
        version: "1.0.0",
        title: "Railpack Configuration",
        description: "Railpack build with build and run commands",
        fields: [
            {
                key: "buildCommand",
                label: "Build Command",
                type: "text",
                required: true,
                schema: { type: "string", minLength: 1 },
                ui: { order: 1 },
            },
            {
                key: "startCommand",
                label: "Start Command",
                type: "text",
                required: true,
                schema: { type: "string", minLength: 1 },
                ui: { order: 2 },
            },
        ],
    },
    external: {
        id: "external",
        version: "1.0.0",
        title: "Pre-built Image Configuration",
        description: "Deploy an image that was built elsewhere — no build step",
        fields: [
            {
                key: "image",
                label: "Image",
                type: "text",
                required: true,
                schema: { type: "string", minLength: 1 },
                ui: { order: 1 },
            },
        ],
    },
};