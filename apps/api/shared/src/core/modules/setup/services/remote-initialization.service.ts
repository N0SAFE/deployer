import { runPromiseUnwrapped } from "@deployer/effect-core";
import { runSyncUnwrapped } from "@deployer/effect-core";
import { AppError } from "@deployer/errors";
import { Injectable, Logger, Inject } from '@nestjs/common'
import {
    meshEnrollmentDescribeResultSchema,
    meshEnrollmentEnrollResultSchema,
    type SetupInitializeRemoteInput,
} from '@deployer/contracts-entities'
import { meshEnrollmentContract } from '@deployer/fleet-contracts'
import { nodeAgentLink, serviceLink } from '@deployer/mesh-client'
import type { ClientContext, ClientLink } from '@orpc/client'
import { NodeConfigRepository, type NodeConfigRepositoryShape } from "@deployer/node-state"
import { EnvService } from "../../../../config/env/env.module"
import { runStep, type EmitEvent, SetupStepTracker } from '../utils/setup-runner.utils'
import { DEPLOYER_VERSION, semverCompare } from '../../../utils/deployer-version'
import type { MeshSwarmJoinGrant } from '@deployer/contracts-entities'
import { SwarmBootstrap, type SwarmBootstrapShape } from "@deployer/swarm"
import { SwarmCluster, type SwarmClusterShape } from "@deployer/swarm"
import { MeshAdmissionService } from '../../mesh-agent/mesh-admission.service'

/** How long a joining node waits for its agent to find the fleet, and how often it asks again. */
const FLEET_WAIT_MS = 60_000
const FLEET_POLL_MS = 2_000

@Injectable()
export class RemoteInitializationService {
    private readonly logger = new Logger(RemoteInitializationService.name)

    constructor(
        @Inject(NodeConfigRepository) private readonly nodeConfigRepository: NodeConfigRepositoryShape,
        private readonly envService: EnvService,
        /** Joins this node to the FLEET's swarm from the grant the fleet issued. */
        @Inject(SwarmBootstrap) private readonly swarmBootstrap: SwarmBootstrapShape,
        /** Read-back of the engine state for the finalize report. */
        @Inject(SwarmCluster) private readonly swarmCluster: SwarmClusterShape,
        /** Enters the peer-equal network in the same exchange as the join grant. */
        private readonly meshAdmission: MeshAdmissionService,
    ) {}

    /** The link to this node's agent: the way a node that is not in the fleet yet reaches it. Overridable in tests. */
    protected agentLink(): ClientLink<ClientContext> | undefined {
        return nodeAgentLink()
    }

    /**
     * Run the remote join flow.
     *
     * Owns: agent_join → mesh_handshake → version_check → register_node → finalize. The operator proved who they are
     * when they issued the join token on a node of the fleet; this node redeems it with its own agent, which joins the
     * swarm, and then asks the fleet to enroll it over the mesh. Nothing here is configured from an address or a
     * password. Returns the final `{ nodeId, databaseUrl }` so the orchestration layer can emit the terminal event.
     */
    async initialize(
        input: SetupInitializeRemoteInput,
        tracker: SetupStepTracker,
        emit: EmitEvent,
    ): Promise<{ nodeId: string; databaseUrl: string }> {
        let nodeId = ''
        let databaseUrl = ''
        /** The fleet's swarm role decision for this node (null = none offered). */
        let swarmGrant: MeshSwarmJoinGrant | null = null
        /** Whether this node entered the cluster's mesh (Swarm then rides it). */
        let meshJoined = false

        const agent = this.agentLink()
        const serverUrl = this.resolveServerUrl() ?? input.serverUrl
        const call = (link: ClientLink<ClientContext>, path: string[], body: unknown): Promise<unknown> =>
            link.call(path, body, { context: {} })

        await runStep(tracker, emit, 'agent_join', 'Join the swarm', async (stepLog) => {
            if (agent === undefined) {
                throw new AppError(
                    'This node has no mesh agent, so it cannot join a fleet. Start the node with its agent and try again.',
                    'INTERNAL_ERROR',
                )
            }
            stepLog('Redeeming the join token with this node\'s agent…')
            const joined = (await call(agent, ['roster', 'join'], { token: input.token })) as { agents: unknown[] }
            stepLog(`✅ The agent joined the swarm and knows ${String(joined.agents.length)} other agent(s)`)
            const view = (await call(agent, ['roster', 'view'], {})) as { self: { nodeId: string } }
            nodeId = view.self.nodeId
            stepLog(`This node is ${nodeId}`)
        })

        // The fleet is reached like any service: through the agent, which finds a replica as gossip teaches it where they are.
        const fleet = agent === undefined ? undefined : serviceLink<ClientContext>({ agent, service: 'fleet', contract: meshEnrollmentContract })
        const askFleet = async (path: string[], body: unknown, stepLog: (line: string) => void): Promise<unknown> => {
            if (fleet === undefined) throw new AppError('This node has no mesh agent', 'INTERNAL_ERROR')
            const deadline = Date.now() + FLEET_WAIT_MS
            for (;;) {
                try {
                    return await call(fleet, path, body)
                } catch (error) {
                    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''
                    // The agent has not learned where the fleet is yet: it will, so wait. Anything else is an answer.
                    if (code !== 'NOT_FOUND' && code !== 'SERVICE_UNAVAILABLE' && code !== 'INTERNAL_SERVER_ERROR') throw error
                    if (Date.now() >= deadline) {
                        throw new AppError('The fleet did not answer through the mesh in time. Check that a node of the fleet is reachable.', 'INTERNAL_ERROR')
                    }
                    stepLog('Waiting for the agent to find the fleet…')
                    await new Promise((resolve) => setTimeout(resolve, FLEET_POLL_MS))
                }
            }
        }

        let meshNetwork: Awaited<ReturnType<typeof meshEnrollmentDescribeResultSchema.parse>>['meshNetwork'] = null
        let fleetVersion = ''

        await runStep(tracker, emit, 'mesh_handshake', 'Connect to the fleet', async (stepLog) => {
            stepLog('Asking the fleet to describe itself…')
            const described = meshEnrollmentDescribeResultSchema.parse(await askFleet(['describe'], { token: input.token }, stepLog))
            meshNetwork = described.meshNetwork
            fleetVersion = described.version
            stepLog(`✅ Reached the fleet, running ${fleetVersion}`)
        })

        // ── Version Check ──────────────────────────────────────────────
        // A node cannot join a fleet running a higher version: it must be upgraded first. A node ahead of the fleet may
        // join, and the fleet's upgrade is for a super admin to trigger.
        await runStep(tracker, emit, 'version_check', 'Version compatibility check', async (stepLog) => {
            stepLog(`Local deployer version: ${DEPLOYER_VERSION}`)
            stepLog(`Fleet version: ${fleetVersion}`)
            const comparison = semverCompare(DEPLOYER_VERSION, fleetVersion)
            if (comparison === 0) {
                stepLog(`✅ Version match: both on ${DEPLOYER_VERSION}. Proceeding with join.`)
                return
            }
            if (comparison < 0) {
                throw new AppError(
                    `⛔ Version mismatch: this node is at ${DEPLOYER_VERSION} but the fleet is at ${fleetVersion}. ` +
                        `A node cannot join a fleet running a higher version. Please upgrade this node to ${fleetVersion} before joining.`,
                    'INTERNAL_ERROR',
                )
            }
            stepLog(
                `⚠️  This node (${DEPLOYER_VERSION}) is ahead of the fleet (${fleetVersion}). ` +
                    `The fleet should be upgraded to ${DEPLOYER_VERSION}. Proceeding with join.`,
            )
        })

        await runStep(tracker, emit, 'register_node', 'Register this node', async (stepLog) => {
            // This node's WireGuard agent signs its own entry for the fleet's mesh; the member that admits it is
            // whichever one the fleet answered from.
            const meshJoinRequest =
                meshNetwork === null
                    ? undefined
                    : await this.meshAdmission.createJoinRequest(meshNetwork).catch((error: unknown) => {
                          stepLog(`⚠️  Mesh join request not created: ${error instanceof Error ? error.message : String(error)}`)
                          return undefined
                      })

            stepLog(`Advertising server URL: ${serverUrl}`)
            const enrolled = meshEnrollmentEnrollResultSchema.parse(
                await askFleet(
                    ['enroll'],
                    {
                        token: input.token,
                        nodeId,
                        serverUrl,
                        // The role THIS node asked for. The fleet replies with what it actually grants: asking for
                        // "auto" makes the node a candidate for master, not a manager by right.
                        requestedSwarmPolicy: input.swarm?.policy,
                        meshJoinRequest,
                    },
                    stepLog,
                ),
            )
            databaseUrl = enrolled.databaseUrl
            swarmGrant = enrolled.swarmGrant
            stepLog(`✅ Enrolled in the fleet as ${enrolled.nodeId}`)

            if (enrolled.meshAdmission === null) {
                stepLog('⚠️  Not admitted into the mesh — Swarm will join over the network it can reach')
            } else {
                await this.meshAdmission.adopt(enrolled.meshAdmission)
                meshJoined = true
                stepLog('✅ Admitted into the mesh — bringing up WireGuard links')
            }
            if (swarmGrant === null) {
                stepLog('⚠️  The fleet has no Swarm cluster to hand over — swarm convergence deferred')
            } else {
                stepLog(`✅ Swarm role granted by the fleet: ${swarmGrant.role}`)
                stepLog(`  reason  = ${swarmGrant.reason}`)
                stepLog(`  control = ${swarmGrant.controlPlaneAddrs.join(', ')}`)
            }
        })

        await runStep(tracker, emit, 'finalize', 'Finalize', async (stepLog) => {
            stepLog('Persisting node config…')
            const now = new Date().toISOString()
            runSyncUnwrapped(this.nodeConfigRepository.upsert({
                nodeId,
                strategy: 'remote',
                setupState: 'setup_done',
                deployerVersion: DEPLOYER_VERSION,
                meshUrlsSnapshot: [],
                databaseUrl,
                // Remote-join shares the mesh owner's database — externally
                // managed, never supervised by this node's GlobalDbSupervisorService.
                databaseProvisioning: 'external' as const,
                configuredAt: now,
                // The FLEET's role decision, persisted so a restart re-converges
                // from the same answer instead of re-asking the mesh.
                swarmConfig:
                    swarmGrant === null
                        ? undefined
                        : {
                              mode: 'join' as const,
                              // "auto" = MAY be master. The mesh already answered
                              // whether this node actually is (swarmGrant.role),
                              // so a granted manager keeps the mixed policy.
                              policy: swarmGrant.role === 'manager' ? ('auto' as const) : ('worker' as const),
                              advertiseAddr: null,
                              joinToken:
                                  swarmGrant.role === 'manager'
                                      ? (swarmGrant.managerToken ?? swarmGrant.workerToken)
                                      : swarmGrant.workerToken,
                              joinAddrs: swarmGrant.controlPlaneAddrs,
                          },
                updatedAt: now,
            }))
            stepLog('✅ Node config persisted')

            // ── Join the FLEET's swarm ─────────────────────────────────────
            // The role comes from the mesh, never from this node's own ambition:
            // the manager join token is withheld unless the fleet admitted this
            // node to quorum. Deferred (not fatal) when the mesh offered no
            // cluster — a node whose fleet has no swarm yet must still complete
            // setup and can converge later from the Cluster page.
            if (swarmGrant === null) {
                stepLog('⚠️  No Swarm cluster offered by the mesh — convergence deferred')
                return
            }

            stepLog(`▸ Joining the mesh Swarm cluster as ${swarmGrant.role}…`)
            stepLog(`  control = ${swarmGrant.controlPlaneAddrs.join(', ')}`)
            // The managers advertise MESH addresses, so the join can only succeed
            // once a WireGuard link is up — wait for it rather than racing it.
            if (meshJoined) {
                const linked = await this.meshAdmission.waitForLink()
                stepLog(linked ? '✅ Mesh link established' : '⚠️  No mesh link yet — attempting the join anyway')
            }
            await runPromiseUnwrapped(this.swarmBootstrap.converge('setup'))
            const snapshot = await runPromiseUnwrapped(this.swarmCluster.getLocalClusterSnapshot())

            if (snapshot.localNodeState === 'active') {
                stepLog('✅ Joined the Swarm cluster')
                stepLog(`  role   = ${snapshot.localNode.swarmRole}`)
                stepLog(`  master = ${snapshot.master?.nodeId ?? 'elected elsewhere'}`)
                stepLog(`  nodes  = ${String(snapshot.nodeCount)} (managers ${String(snapshot.managerCount)})`)
            } else {
                stepLog(`⚠️  Swarm join not active (state=${snapshot.localNodeState}) — retry from the Cluster page`)
            }
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