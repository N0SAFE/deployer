import type { ConfigSchema } from "../domain";

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
    static: {
        id: "static",
        version: "1.0.0",
        title: "Static Builder Configuration",
        description: "Configure static output and fallback behavior",
        fields: [
            {
                key: "outputDir",
                label: "Output Directory",
                type: "text",
                required: true,
                defaultValue: "dist",
                schema: { type: "string", minLength: 1 },
                ui: { order: 1 },
            },
            {
                key: "fallbackFile",
                label: "SPA Fallback File",
                type: "text",
                required: false,
                defaultValue: "index.html",
                schema: { type: "string" },
                ui: { order: 2 },
            },
        ],
    },
};