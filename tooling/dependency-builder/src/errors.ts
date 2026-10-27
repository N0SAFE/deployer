/**
 * Error types for the dependency-builder.
 *
 * Each carries the data needed to act on it, so a failure names the package or
 * path that caused it rather than just saying something went wrong.
 */

export class WorkspaceScanError extends Error {
    constructor(
        message: string,
        readonly root: string
    ) {
        super(message)
        this.name = 'WorkspaceScanError'
    }
}

/**
 * No application could be resolved from the environment.
 *
 * The enablement comes from compose's `COMPOSE_PROFILES`, so this failure almost
 * always means the container was started outside a compose profile (or with an
 * empty value) — which is worth naming, because the union would otherwise be
 * empty and every application would fail later with a missing-package error far
 * from the cause.
 */
export class NoEnabledApplicationsError extends Error {
    constructor(readonly detail: string) {
        super(
            `No enabled applications: ${detail}. ` +
                'The dependency-builder reads compose\'s COMPOSE_PROFILES; start it through a compose profile (see infra/docker/compose/).'
        )
        this.name = 'NoEnabledApplicationsError'
    }
}

export class UnknownWorkspaceError extends Error {
    constructor(
        readonly workspaceName: string,
        readonly known: readonly string[]
    ) {
        super(
            `Workspace "${workspaceName}" is not part of the repository. ` +
                `Known workspaces: ${known.slice(0, 10).join(', ')}${known.length > 10 ? ', …' : ''}`
        )
        this.name = 'UnknownWorkspaceError'
    }
}

export class BuildFailedError extends Error {
    constructor(
        readonly command: readonly string[],
        readonly exitCode: number
    ) {
        super(
            `Command failed with exit code ${String(exitCode)}: ${command.join(' ')}`
        )
        this.name = 'BuildFailedError'
    }
}
