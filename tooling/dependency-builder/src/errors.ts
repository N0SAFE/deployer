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

export class NoEnabledApplicationsError extends Error {
    constructor(readonly inputsRoot: string) {
        super(
            `No enabled applications found under ${inputsRoot}. ` +
                'Mount at least one application workspace (see infra/docker/compose/).'
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
