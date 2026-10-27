import type { BuilderMetadata } from "@deployer/provider-schema/domain/index";

/**
 * Builder catalog — the metadata the UI renders for each builder.
 *
 * ── METADATA ONLY, NOT THE SOURCE OF TRUTH ─────────────────────────────────
 * Which builders can actually build is decided by `BuilderRegistryService`
 * (`apps/api/src/modules/deployment/builders/`), which knows each strategy's real
 * availability. This file only supplies names, icons and copy.
 *
 * ── WHAT WAS WRONG BEFORE ──────────────────────────────────────────────────
 * The catalog listed three entries and one of them — `"static"` — was not a builder at
 * all: it is neither a member of `deploymentBuilderKindSchema` nor registered by any
 * strategy, so choosing it in the UI could only fail at deploy time. The four builders
 * that DO exist in the schema were missing entirely (`docker_compose`, `buildpack`,
 * `railpack`, `external`).
 *
 * A catalog that disagrees with the registry is exactly how inert options accumulate. The
 * ids below are the members of `deploymentBuilderKindSchema`, and
 * `catalog/__tests__/builders.spec.ts` asserts that so it cannot drift again.
 */
export const buildersCatalog: BuilderMetadata[] = [
    {
        id: "dockerfile",
        name: "Dockerfile",
        description: "Build and run from a Dockerfile in the repository",
        icon: "container",
        category: "container",
        compatibleProviders: ["github", "upload"],
        tags: ["docker", "container"],
    },
    {
        id: "docker_compose",
        name: "Docker Compose",
        description: "Build from a compose file; services are realised by the orchestrator",
        icon: "layers",
        category: "container",
        compatibleProviders: ["github", "upload"],
        tags: ["docker", "compose", "multi-service"],
    },
    {
        id: "nixpacks",
        name: "Nixpacks",
        description: "Auto-detect the runtime and generate a build (requires build/run commands)",
        icon: "package",
        category: "container",
        compatibleProviders: ["github", "upload"],
        tags: ["buildpack", "autodetect", "node", "python", "go", "rust"],
    },
    {
        id: "buildpack",
        name: "Buildpacks",
        description: "CNCF buildpacks via a custom builder (requires build/run commands)",
        icon: "boxes",
        category: "container",
        compatibleProviders: ["github", "upload"],
        tags: ["buildpack", "cnb"],
    },
    {
        id: "railpack",
        name: "Railpack",
        description: "Railpack-generated build (requires build/run commands)",
        icon: "train-front",
        category: "container",
        compatibleProviders: ["github", "upload"],
        tags: ["buildpack", "autodetect"],
    },
    {
        id: "external",
        name: "Pre-built image",
        description: "Deploy an image built elsewhere — no build step",
        icon: "external-link",
        category: "container",
        compatibleProviders: ["github", "upload", "gitlab", "custom"],
        tags: ["image", "registry", "byo"],
    },
];
