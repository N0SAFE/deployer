/**
 * BuilderStrategy — the public entry point for "how do we turn source into an artifact".
 *
 * ── WHY THIS INTERFACE EXISTS ────────────────────────────────────────────
 * `DeploymentArtifactBuilderService` used to dispatch with an inline chain:
 *
 *   if (builder === "dockerfile")      { … buildImage(…) }
 *   if (builder === "docker_compose")  { … buildCompose(…) }
 *   // nixpacks/buildpack/railpack remain containerized via docker image build.
 *
 * The trailing comment was the bug: those three fell through to `buildImage` with no
 * `dockerfileName`, which throws "Dockerfile not found". The UI offered six builders
 * and three of them could never succeed, and because the chain was inline there was no
 * place to express "this builder is not implemented" — so nothing did.
 *
 * With this seam, "is this builder real?" is answerable at RUNTIME (`isAvailable()`),
 * so the catalog the UI renders can be derived from the registry instead of being a
 * hand-maintained list that drifts from reality.
 *
 * ── WHY `isAvailable()` AND NOT ONLY `build()` ──────────────────────────
 * A strategy can be registered while its toolchain is absent (nixpacks needs the
 * `nixpacks` binary; a future strategy might need a remote builder). Reporting that
 * separately from "there is no strategy" lets the API reject with a precise reason
 * ("nixpacks is not installed on this node") instead of a generic
 * "unsupported builder", and lets the UI hide or disable the option honestly.
 */
export type BuilderStrategy = {
    /** Dispatch key, lowercase: "dockerfile" | "docker_compose" | "nixpacks" | … */
    readonly builderType: string;

    /**
     * Whether this strategy can actually run here, right now.
     *
     * Synchronous on purpose: it is consulted on the trigger path (to reject early)
     * and when rendering the catalog (to decide what to offer). A strategy that needs
     * an async probe should cache the answer at boot.
     */
    isAvailable(): boolean;

    /** Human-readable reason when `isAvailable()` is false. */
    unavailableReason(): string;

    /**
     * Produce the artifact for an already-checked-out build context.
     *
     * The context (clone/extract, guards, custom-command Dockerfile) is prepared by
     * the caller because it is IDENTICAL for every strategy — duplicating it per
     * strategy would be the DRY violation this refactor removes.
     */
    build(context: BuilderStrategyContext): Promise<BuilderStrategyResult>;
}

export type BuilderStrategyContext = {
    /** Absolute path to the checked-out/extracted build context. */
    readonly buildContextPath: string;
    /** The deployment this artifact belongs to (for tagging). */
    readonly deploymentId: string;
    /** The service being deployed (for tagging). */
    readonly serviceId: string;
    /**
     * Dockerfile the caller prepared for custom build/run commands, if any.
     *
     * Present only when the operator supplied custom commands; a strategy that
     * cannot honour it must reject rather than silently ignoring it.
     */
    readonly dockerfileName: string | null;
    /**
     * The image tag to produce.
     *
     * Supplied by the caller rather than derived here so the tag SCHEME stays in one
     * place across every builder — a strategy deriving its own would make pruning,
     * cache tagging and cleanup impossible to implement once for all builders.
     */
    readonly imageTag: string;
}

/**
 * What a strategy produced.
 *
 * `image` is `null` for builders whose artifact is not a single image — a compose
 * project, for instance, where the runtime is addressed by project name. The caller
 * treats `null` as "defer to the project/compose runtime", which is exactly what the
 * old inline code did for `docker_compose`.
 */
export type BuilderStrategyResult = {
    readonly image: string | null;
}
