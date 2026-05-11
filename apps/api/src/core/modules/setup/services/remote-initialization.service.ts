import { Injectable, Logger } from '@nestjs/common'
import type { SetupInitializeRemoteInput, SetupStreamEvent } from '@repo/contracts-entities'
import type { Subscriber } from 'rxjs'
import { NodeConfigRepository } from '../repositories/node-config.repository'
import { InitializationService } from './initialization.service'
import { MeshInitializationService } from '../../mesh/initialization/services/mesh-initialization.service';

@Injectable()
export class RemoteInitializationService {
    private readonly logger = new Logger(RemoteInitializationService.name)

    constructor(
        private readonly meshInitializationService: MeshInitializationService,
        private readonly nodeConfigRepository: NodeConfigRepository,
    ) {}

    async initialize(
        input: SetupInitializeRemoteInput,
        subscriber: Subscriber<SetupStreamEvent>,
    ): Promise<void> {

        // ── Step: mesh_handshake ─────────────────────────────────────────────
        subscriber.next(InitializationService.stepStart('mesh_handshake', 'Connect to mesh'))
        const handshakeStart = Date.now()
        let bootstrapConfig: Awaited<ReturnType<MeshInitializationService['bootstrap']>>
        try {
            subscriber.next(InitializationService.stepLog('mesh_handshake', `Connecting to mesh at ${input.meshUrl}…`))
            bootstrapConfig = await this.meshInitializationService.bootstrap(
                input.meshUrl,
                input.authToken,
                // serverUrl is not in the contract input — derive from meshUrl origin or leave empty
                '',
            )
            subscriber.next(InitializationService.stepLog('mesh_handshake', `✅ Handshake successful — remote node ${bootstrapConfig.nodeId}`))
            subscriber.next(InitializationService.stepComplete('mesh_handshake', Date.now() - handshakeStart))
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            subscriber.next(InitializationService.stepFailed('mesh_handshake', error, Date.now() - handshakeStart))
            throw err
        }

        // ── Step: register_node ──────────────────────────────────────────────
        subscriber.next(InitializationService.stepStart('register_node', 'Register this node'))
        const registerStart = Date.now()
        let meshUrls: string[] = []
        try {
            subscriber.next(InitializationService.stepLog('register_node', 'Fetching peer node URLs…'))
            meshUrls = await this.meshInitializationService.getMeshNodeUrls(
                input.meshUrl,
                bootstrapConfig.nodeId,
            )
            subscriber.next(InitializationService.stepLog('register_node', `✅ Found ${String(meshUrls.length)} peer(s)`))
            subscriber.next(InitializationService.stepComplete('register_node', Date.now() - registerStart))
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            subscriber.next(InitializationService.stepFailed('register_node', error, Date.now() - registerStart))
            throw err
        }

        // ── Step: finalize ───────────────────────────────────────────────────
        subscriber.next(InitializationService.stepStart('finalize', 'Finalize'))
        const finalizeStart = Date.now()
        try {
            subscriber.next(InitializationService.stepLog('finalize', 'Persisting node config…'))
            const now = new Date().toISOString()
            this.nodeConfigRepository.upsert({
                nodeId:           bootstrapConfig.nodeId,
                strategy:         'remote',
                meshUrlsSnapshot: meshUrls,
                databaseUrl:      bootstrapConfig.databaseUrl,
                configuredAt:     bootstrapConfig.enrolledAt,
                updatedAt:        now,
            })
            subscriber.next(InitializationService.stepLog('finalize', '✅ Node config persisted'))
            subscriber.next(InitializationService.stepComplete('finalize', Date.now() - finalizeStart))
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            subscriber.next(InitializationService.stepFailed('finalize', error, Date.now() - finalizeStart))
            throw err
        }

        // ── Final event ──────────────────────────────────────────────────────
        subscriber.next(
            InitializationService.completed(bootstrapConfig.nodeId, 'remote', bootstrapConfig.databaseUrl),
        )
    }
}