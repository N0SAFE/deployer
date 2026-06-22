import { Injectable, Logger } from '@nestjs/common'
import type { SetupInitializeRemoteInput } from '@repo/contracts-entities'
import { NodeConfigRepository } from '../repositories/node-config.repository'
import { MeshInitializationService } from '../../mesh/initialization/services/mesh-initialization.service'
import { EnvService } from '@/config/env/env.service'
import { runStep, type EmitEvent, SetupStepTracker } from '../utils/setup-runner.utils'

@Injectable()
export class RemoteInitializationService {
    private readonly logger = new Logger(RemoteInitializationService.name)

    constructor(
        private readonly meshInitializationService: MeshInitializationService,
        private readonly nodeConfigRepository: NodeConfigRepository,
        private readonly envService: EnvService,
    ) {}

    /**
     * Run the remote bootstrap flow after reachability has been confirmed.
     *
     * Owns: grant_issue → mesh_handshake → register_node → finalize.
     * Returns the final `{ nodeId, databaseUrl }` so the orchestration
     * layer can emit the terminal `completed` event.
     */
    async initialize(
        input: SetupInitializeRemoteInput,
        tracker: SetupStepTracker,
        emit: EmitEvent,
    ): Promise<{ nodeId: string; databaseUrl: string }> {
        let nodeId = ''
        let databaseUrl = ''
        let meshUrls: string[] = []
        let peerServiceToken: string | null = null
        let peerServiceTokenExpiresAt: string | null = null
        let meshSharedSecret: string | null = null

        // Resolve the local server URL once so we can pass it to the
        // remote mesh as the address it should use to reach us back.
        const serverUrl = this.resolveServerUrl()

        await runStep(tracker, emit, 'mesh_handshake', 'Connect to mesh', async (stepLog) => {
            stepLog(`Connecting to mesh at ${input.meshUrl}…`)
            if (serverUrl) {
                stepLog(`Advertising server URL: ${serverUrl}`)
            }

            // Step 1: Issue a one-time join grant on the remote mesh
            //         using the authenticated Better Auth session.
            //         The authToken from remoteAuth is a session cookie,
            //         NOT a join grant token — we must first issue the
            //         grant via the remote mesh's issueJoinGrant endpoint
            //         (which requires requireAuth()), then consume it.
            stepLog('Issuing join grant on remote mesh…')
            const grantToken = await this.meshInitializationService.issueRemoteJoinGrant(
                input.meshUrl,
                input.authToken,
            )
            stepLog('✅ Join grant issued — consuming…')

            // Step 2: Consume the grant to complete the bootstrap handshake.
            const bootstrapConfig = await this.meshInitializationService.bootstrap(
                input.meshUrl,
                grantToken,
                serverUrl ?? new URL(input.meshUrl).origin,
            )
            nodeId = bootstrapConfig.nodeId
            databaseUrl = bootstrapConfig.databaseUrl
            peerServiceToken = bootstrapConfig.peerServiceToken
            peerServiceTokenExpiresAt = bootstrapConfig.peerServiceTokenExpiresAt
            meshSharedSecret = bootstrapConfig.meshSharedSecret
            stepLog(`✅ Handshake successful — remote node ${bootstrapConfig.nodeId}`)
        })

        await runStep(tracker, emit, 'register_node', 'Register this node', async (stepLog) => {
            stepLog('Fetching peer node URLs…')
            meshUrls = await this.meshInitializationService.getMeshNodeUrls(input.meshUrl, nodeId, peerServiceToken)
            stepLog(`✅ Found ${String(meshUrls.length)} peer(s)`)
        })

        await runStep(tracker, emit, 'finalize', 'Finalize', async (stepLog) => {
            stepLog('Persisting node config…')
            const now = new Date().toISOString()
            this.nodeConfigRepository.upsert({
                nodeId,
                strategy: 'remote',
                meshUrlsSnapshot: meshUrls,
                databaseUrl,
                configuredAt: now,
                peerServiceToken: peerServiceToken ?? undefined,
                peerServiceTokenExpiresAt: peerServiceTokenExpiresAt ?? undefined,
                meshSharedSecret: meshSharedSecret ?? undefined,
                meshSharedSecretUpdatedAt: meshSharedSecret ? now : undefined,
                updatedAt: now,
            })
            stepLog('✅ Node config persisted')
        })

        return { nodeId, databaseUrl }
    }

    /**
     * Resolve the public URL that this node advertises to the mesh.
     *
     * Uses the same priority as `SystemMeshController.resolveAdvertisedHost`:
     *   1. `APP_URL` env (canonical — what the operator set in their config)
     *   2. `NEXT_PUBLIC_APP_URL` env (public web URL — fallback)
     *
     * Returns `null` if neither is set or the value is empty. The caller
     * should fall back to the mesh URL's origin when null.
     */
    private resolveServerUrl(): string | null {
        const candidate = this.envService.get('APP_URL')?.toString().trim()
            ?? this.envService.get('NEXT_PUBLIC_APP_URL')?.toString().trim()
        if (!candidate) {
            return null
        }
        try {
            const parsed = new URL(candidate)
            return parsed.toString()
        } catch {
            return null
        }
    }
}