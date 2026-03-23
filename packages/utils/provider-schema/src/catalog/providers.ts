import type { ProviderMetadata } from "../domain";

export const providersCatalog: ProviderMetadata[] = [
    {
        id: "github",
        name: "GitHub",
        description: "Deploy from GitHub repositories",
        icon: "github",
        category: "git",
        supportedBuilders: ["dockerfile", "nixpacks", "static"],
        tags: ["git", "github", "ci-cd"],
    },
    {
        id: "static",
        name: "Static Upload",
        description: "Deploy static assets from uploaded artifacts",
        icon: "upload",
        category: "manual",
        supportedBuilders: ["static"],
        tags: ["static", "upload"],
    },
];