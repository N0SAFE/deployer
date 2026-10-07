import { Module } from '@nestjs/common'

import { BuildCommand } from '../commands/build.command'
import { WorkspaceScanner } from '../services/workspace-scanner.service'
import { UnionPlanner } from '../services/union-planner.service'
import { TurboRunner } from '../services/turbo-runner.service'

/**
 * The dependency-builder's Nest module.
 *
 * Three providers, each with one job:
 *   WorkspaceScanner — read the workspace graph from the manifests on disk
 *   UnionPlanner     — compute and deduplicate the enabled applications' union
 *   TurboRunner      — link outputs, build the union once, then watch
 *
 * The command wires them; it holds no logic of its own beyond ordering.
 */
@Module({
    providers: [WorkspaceScanner, UnionPlanner, TurboRunner, BuildCommand],
})
export class DependencyBuilderModule {}
