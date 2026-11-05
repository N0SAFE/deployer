import { Context } from 'effect'

import type { DeploymentStateMachineShape } from '@deployer/shared/core/modules/deployment/services/deployment-provider-builder-runner-state-machine.service'
import type { GitServiceShape } from '@deployer/shared/core/modules/git/git/services/git.service'

/**
 * What the artifact builder depends on and has no Effect version of yet, as ports over Promise-based
 * providers of the shared core; the deployment module binds each with `useExisting`.
 */
export class BuilderGitPort extends Context.Service<
    BuilderGitPort,
    GitServiceShape
>()('runtime/BuilderGitPort') {}
export class BuilderStateMachinePort extends Context.Service<
    BuilderStateMachinePort,
    DeploymentStateMachineShape
>()('runtime/BuilderStateMachinePort') {}
