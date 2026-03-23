import type { ConfigSchema } from "../domain";

export const providerSchemasCatalog: Record<string, ConfigSchema> = {
    github: {
        id: "github",
        version: "1.0.0",
        title: "GitHub Provider Configuration",
        description: "Configure repository source and checkout options",
        fields: [
            {
                key: "repositoryUrl",
                label: "Repository URL",
                type: "url",
                required: true,
                schema: { type: "string", format: "uri" },
                placeholder: "https://github.com/owner/repo",
                ui: { order: 1, fullWidth: true },
            },
            {
                key: "branch",
                label: "Branch",
                type: "text",
                required: false,
                defaultValue: "main",
                schema: { type: "string", minLength: 1 },
                ui: { order: 2 },
            },
            {
                key: "buildContext",
                label: "Build Context",
                type: "text",
                required: false,
                defaultValue: ".",
                schema: { type: "string" },
                placeholder: ".",
                ui: { order: 3 },
            },
        ],
    },
    static: {
        id: "static",
        version: "1.0.0",
        title: "Static Provider Configuration",
        description: "Configure uploaded artifact deployment behavior",
        fields: [
            {
                key: "artifactPath",
                label: "Artifact Path",
                type: "text",
                required: true,
                schema: { type: "string", minLength: 1 },
                placeholder: "dist/",
                ui: { order: 1, fullWidth: true },
            },
            {
                key: "cleanUrls",
                label: "Clean URLs",
                type: "boolean",
                required: false,
                defaultValue: true,
                schema: { type: "boolean" },
                ui: { order: 2, inline: true },
            },
        ],
    },
};