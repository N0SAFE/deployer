import { Module } from '@nestjs/common'

import { BuildCommand } from '../commands/build.command'
import { WorkspaceScanner } from '../services/workspace-scanner.service'
import { UnionPlanner } from '../services/union-planner.service'
import { TurboRunner } from '../services/turbo-runner.service'
import { ApplicationDetector } from '../services/application-detector.service'

/**
 * The dependency-builder's Nest module.
 *
 * Providers, each with one job:
 *   ApplicationDetector — which applications compose has enabled (COMPOSE_PROFILES)
 *   WorkspaceScanner    — read the workspace graph from the manifests on disk
 *   UnionPlanner        — compute and deduplicate the enabled applications' union
 *   TurboRunner         — link outputs, build the union once, then watch
 *
 * The command wires them; it holds no logic of its own beyond ordering.
 */
@Module({
    providers: [
        ApplicationDetector,
        WorkspaceScanner,
        UnionPlanner,
        TurboRunner,
        BuildCommand,
    ],
})
export class DependencyBuilderModule {}
