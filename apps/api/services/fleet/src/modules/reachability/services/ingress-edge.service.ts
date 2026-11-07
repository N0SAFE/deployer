/**
 * IngressEdgeService — what the Network pages read and change: the lanes, the
 * public edge, the DNS records they need, and the mesh they ride on.
 *
 * Orchestration only — every decision has an owner elsewhere:
 *
 *   the lanes                   IngressLanesService     (replicated cluster setting)
 *   which edge, its rules       EdgeProviderRegistry    (validation, inbound-port consent)
 *   the edge itself             the EdgeProvider        (provision / teardown / status)
 *   the DNS records             EdgeDnsService          (separate plane from ingress)
 *   the ingress processes       TraefikConfigRefresherShape  (re-converge now, not next sweep)
 *   the mesh view               this node's agent, over its node door
 *
 * ── SWITCHING THE PUBLIC EDGE ───────────────────────────────────────────────
 * New edge first, lanes second, old edge last:
 *
 *   1. provision the new edge — if it cannot exist, nothing changes;
 *   2. write the lanes — Traefik, the connector and DNS follow them;
 *   3. tear the previous edge down (best effort — the lane no longer names it, so
 *      it carries nothing even if its provider is unreachable right now).
 *
 * Turning the public lane OFF always succeeds for the same reason: the lane is the
 * switch, the teardown is cleanup.
 */

import { Context, Effect } from 'effect'

import {
    ingressExposure,
    ingressLanesSchema,
    joinEntryPoints,
    type IngressLanes,
    type PublicLane,
} from '@deployer/contracts-entities/entities/ingress/index'
import type {
    IngressState,
    UpdateIngressInput,
} from '@deployer/fleet-contracts/modules/reachability/contracts'
import type {
    NodeDoorStatus,
    NodeDoorView,
} from '@deployer/mesh-client'
import type { RequirementsOf } from '@deployer/effect-core'
import { EdgeProviderRegistry } from '@deployer/shared/core/modules/edge/edge-provider.registry'
import type { EdgeProviderRegistryShape } from '@deployer/shared/core/modules/edge/edge-provider.registry'
import {
    IngressLanesService,
    type IngressLanesServiceShape,
} from '@deployer/shared/core/modules/platform-ingress/services/ingress-lanes.service'
import {
    PublicEdgeService,
    type PublicEdgeServiceShape,
} from '@deployer/shared/core/modules/reachability/services/public-edge.service'
import {
    TraefikConfigRefresher,
    type TraefikConfigRefresherShape,
} from '@deployer/shared/core/modules/traefik/services/traefik-config-refresher.service'

import type { DnsProviderRegistryServices } from '@/modules/providers/dns/shared/dns-provider-registry.service'

import { attempt } from '../../../core/effects'
import { FleetInvalid } from '../../../core/fleet.errors'
import { NodeAgentUnsupported } from '../reachability.errors'
import { HostnamesPort, NodeAgentPort } from '../reachability.ports'

import { EdgeDnsService } from './edge-dns.service'
import { planLaneDnsRecords } from './lane-dns-plan'

/** Converge DNS on this cadence too: mesh addresses and public addresses change. */
export const DNS_RECONCILE_INTERVAL_MS = 10 * 60_000

type MeshView = IngressState['mesh']

/** A record name the public edge owned before a change, and the account it lived on. */
type RetiredDnsName = {
    name: string
    accountId: string | null
}

const describe = (error: unknown) =>
    error instanceof Error ? error.message : String(error)

/**
 * A use case fails with a `FleetInvalid` refusal of its own, or with what a platform collaborator
 * refused with (left as thrown; the `.effect()` boundary lets it through for the host to translate).
 */
/**
 * What the ingress edge reads from the Effect context while it runs.
 *
 * Aliased once, before the shape, so the two never drift — but each member is the collaborator plus
 * the requirements that collaborator itself leaves open (`ClusterSettings` behind the lanes,
 * `DatabasePort` behind the addresses). Listing only the tags a method names is not enough: `yield*`
 * on a collaborator's method widens the channel to what that method needs.
 */
type IngressEdgePorts =
    | IngressLanesService
    | RequirementsOf<IngressLanesServiceShape>
    | EdgeProviderRegistry
    | RequirementsOf<EdgeProviderRegistryShape>
    | PublicEdgeService
    | RequirementsOf<PublicEdgeServiceShape>
    | NodeAgentPort
    | HostnamesPort
    | TraefikConfigRefresher
    | RequirementsOf<TraefikConfigRefresherShape>
    | EdgeDnsService
    | DnsProviderRegistryServices

export type IngressEdgeServiceShape = {
    readonly getState: () => Effect.Effect<IngressState, unknown, IngressEdgePorts>
    /** Apply a partial lanes change; only the fields sent change. */
    readonly update: (
        input: UpdateIngressInput
    ) => Effect.Effect<IngressState, unknown, IngressEdgePorts>
    /** Delete everything the public edge created, then turn the public lane off. */
    readonly teardownPublicEdge: () => Effect.Effect<
        IngressState,
        unknown,
        IngressEdgePorts
    >
    /** Revoke a mesh member from this node's agent; every member drops it on the next gossip round. */
    readonly revokeMeshMember: (
        memberId: string,
        reason: string
    ) => Effect.Effect<IngressState, unknown, IngressEdgePorts>
    /** Converge the DNS records the lanes need. Never fails. */
    readonly reconcileDns: (
        retired?: readonly RetiredDnsName[]
    ) => Effect.Effect<void, never, IngressEdgePorts>
}

/**
 * The console addresses the lanes imply: a projection of values the caller already asked for, so a
 * plain function. It reads no collaborator, which is what keeps it out of the class.
 */
function consoleUrls(
    lanes: IngressLanes,
    secure: boolean,
    webOrigin: string
): IngressState['consoleUrls'] {
    const port = lanes.entryPort === 80 ? '' : `:${String(lanes.entryPort)}`
    const publicLane = lanes.public
    return {
        local: `${webOrigin}${port}`,
        private: lanes.private.enabled
            ? `http://web.${lanes.private.domain}${port}`
            : null,
        public:
            publicLane !== null && lanes.consoleVisibility === 'public'
                ? `${secure ? 'https' : 'http'}://web.${publicLane.domain}`
                : null,
    }
}

/**
 * Tag and implementation together: the tag is the contract, `live` the one implementation.
 *
 * Every use case below IS the logic: the collaborator a step needs is yielded in that step. There is no
 * `Ports` record, no `implOverPorts(ports)` shape built per call and no forwarding — a method that only
 * built another object and delegated to it would be that other object, and would live there instead.
 */
export class IngressEdgeService extends Context.Service<
    IngressEdgeService,
    IngressEdgeServiceShape
>()('fleet/IngressEdgeService') {
    /**
     * Collaborators are yielded per call, so this is a class the module provides with `useClass`.
     * The periodic DNS reconcile is `startIngressDnsReconciler`'s job: an instance has no lifetime of its own.
     */
    static readonly live = class IngressEdgeServiceImpl
        implements IngressEdgeServiceShape
    {
        /**
         * What this node's agent answers on its door: the kernel's view of the interface (`status`)
         * and the roster it knows (`view`). Both are null when the node runs no new agent — that is
         * "no agent", not an error.
         */
        private readDoor(): Effect.Effect<
            readonly [NodeDoorStatus | null, NodeDoorView | null],
            unknown,
            IngressEdgePorts
        > {
            return Effect.gen(function* () {
                const mesh = yield* NodeAgentPort
                return yield* Effect.all(
                    [attempt(() => mesh.status()), attempt(() => mesh.view())],
                    { concurrency: 'unbounded' }
                )
            })
        }

        /** The mesh as this node sees it; an unreachable agent is reported, not raised. */
        private meshView(): Effect.Effect<MeshView, never, IngressEdgePorts> {
            return this.readDoor().pipe(
                Effect.map(([status, view]) => toMeshView(status, view)),
                Effect.catch((error) =>
                    Effect.succeed<MeshView>({
                        available: false,
                        clusterId: null,
                        cidr: null,
                        address: null,
                        listenPort: null,
                        interfaceUp: false,
                        members: [],
                        doors: [],
                        lastGossipAt: null,
                        lastError: describe(error),
                    })
                )
            )
        }

        /** The names the current public edge owns: candidates for removal after a change. */
        private retiredNames(
            lanes: IngressLanes
        ): Effect.Effect<RetiredDnsName[], never, IngressEdgePorts> {
            return Effect.gen(function* () {
                const publicEdge = yield* PublicEdgeService
                return yield* publicEdge.dnsRecords(lanes).pipe(
                    Effect.map((records) =>
                        records.map((record) => ({
                            name: record.name,
                            accountId: record.preferredAccountId,
                        }))
                    ),
                    Effect.orElseSucceed((): RetiredDnsName[] => [])
                )
            })
        }

        private teardownProvider(
            providerId: string,
            strict: boolean
        ): Effect.Effect<void, unknown, IngressEdgePorts> {
            return Effect.gen(function* () {
                const edges = yield* EdgeProviderRegistry
                const provider = edges.find(providerId)
                if (provider === null) return
                yield* provider.teardown().pipe(
                    Effect.catch((error) =>
                        strict
                            ? Effect.fail(error)
                            : Effect.logWarning(
                                  `${provider.descriptor.label} not torn down (it no longer carries the public lane): ${describe(error)}`
                              )
                    )
                )
            })
        }

        /**
         * The requested public lane, validated against its provider. Options sent for the SAME
         * provider replace the current ones; omitted options keep them, so toggling the domain does
         * not require re-sending the account.
         */
        private toPublicLane(
            input: NonNullable<UpdateIngressInput['public']> | null,
            current: PublicLane | null
        ): Effect.Effect<PublicLane | null, unknown, IngressEdgePorts> {
            return Effect.gen(function* () {
                if (input === null) return null
                const edges = yield* EdgeProviderRegistry
                const sameProvider = current?.provider === input.provider
                return yield* edges.normalize({
                    provider: input.provider,
                    domain: input.domain,
                    acknowledgedInboundPorts:
                        input.acknowledgedInboundPorts ??
                        (sameProvider ? current.acknowledgedInboundPorts : false),
                    options:
                        input.options ?? (sameProvider ? current.options : {}),
                })
            })
        }

        getState(): ReturnType<IngressEdgeServiceShape['getState']> {
            return Effect.gen({ self: this }, function* () {
                const lanesPort = yield* IngressLanesService
                const edges = yield* EdgeProviderRegistry
                const publicEdge = yield* PublicEdgeService
                const hostnames = yield* HostnamesPort
                const dns = yield* EdgeDnsService

                const lanes = yield* lanesPort.getLanes()
                const [mesh_, edge, publicPath] = yield* Effect.all(
                    [
                        this.meshView(),
                        publicEdge.view(lanes),
                        publicEdge.joinPath(lanes),
                    ],
                    { concurrency: 'unbounded' }
                )
                return {
                    lanes,
                    exposure: ingressExposure(lanes, edge?.provider ?? null),
                    domains: {
                        local: hostnames.localDomain(),
                        private: lanes.private.enabled
                            ? lanes.private.domain
                            : null,
                        public: lanes.public?.domain ?? null,
                    },
                    consoleUrls: consoleUrls(
                        lanes,
                        edges.ingressPlan(lanes).tls !== 'none',
                        hostnames.webOrigin()
                    ),
                    edge: { providers: edges.descriptors(), active: edge },
                    dns: yield* dns.results(),
                    mesh: mesh_,
                    // Counts NODE members only: an operator laptop is a member but serves no entry.
                    entryPoints: joinEntryPoints({
                        lanes,
                        memberCount: mesh_.members.filter(
                            (member) =>
                                member.kind === 'node' &&
                                member.state === 'active'
                        ).length,
                        publicPath,
                    }),
                } satisfies IngressState
            })
        }

        update(
            input: UpdateIngressInput
        ): ReturnType<IngressEdgeServiceShape['update']> {
            return Effect.gen({ self: this }, function* () {
                const lanesPort = yield* IngressLanesService
                const publicEdge = yield* PublicEdgeService
                const refresher = yield* TraefikConfigRefresher

                const current = yield* lanesPort.getLanes()
                const next: IngressLanes = {
                    entryPort: input.entryPort ?? current.entryPort,
                    private:
                        input.private === undefined
                            ? current.private
                            : {
                                  enabled: input.private.enabled,
                                  domain:
                                      input.private.domain ??
                                      current.private.domain,
                                  exposeOnLan:
                                      input.private.exposeOnLan ??
                                      current.private.exposeOnLan,
                              },
                    public:
                        input.public === undefined
                            ? current.public
                            : yield* this.toPublicLane(
                                  input.public,
                                  current.public
                              ),
                    consoleVisibility:
                        input.consoleVisibility ?? current.consoleVisibility,
                }
                const parsed = ingressLanesSchema.safeParse(next)
                if (!parsed.success)
                    return yield* new FleetInvalid({
                        reason: `Invalid lanes: ${parsed.error.message}`,
                    })
                const lanes = parsed.data

                const retired = yield* this.retiredNames(current)

                // 1. The new edge must exist before the lanes claim it.
                if (lanes.public !== null) {
                    const resolved = yield* publicEdge.resolve(lanes)
                    if (resolved === null) {
                        return yield* new FleetInvalid({
                            reason: `Unknown edge provider '${lanes.public.provider}'`,
                        })
                    }
                    yield* resolved.provider.provision(resolved.ctx)
                }
                // 2. The switch.
                yield* lanesPort.setLanes(lanes)
                // 3. The old edge carries nothing any more; clean it up.
                if (
                    current.public !== null &&
                    current.public.provider !== lanes.public?.provider
                ) {
                    yield* this.teardownProvider(current.public.provider, false)
                }

                yield* this.reconcileDns(retired)
                refresher.refresh()
                return yield* this.getState()
            })
        }

        teardownPublicEdge(): ReturnType<
            IngressEdgeServiceShape['teardownPublicEdge']
        > {
            return Effect.gen({ self: this }, function* () {
                const lanesPort = yield* IngressLanesService
                const refresher = yield* TraefikConfigRefresher

                const lanes = yield* lanesPort.getLanes()
                if (lanes.public === null) return yield* this.getState()
                const retired = yield* this.retiredNames(lanes)
                // Explicit request: a provider failure is reported, not swallowed.
                yield* this.teardownProvider(lanes.public.provider, true)
                yield* lanesPort.setLanes({ ...lanes, public: null })
                yield* this.reconcileDns(retired)
                refresher.refresh()
                return yield* this.getState()
            })
        }

        revokeMeshMember(
            memberId: string,
            reason: string
        ): ReturnType<IngressEdgeServiceShape['revokeMeshMember']> {
            return Effect.gen({ self: this }, function* () {
                const mesh = yield* NodeAgentPort
                const [, view] = yield* this.readDoor()
                if (view === null) {
                    return yield* new NodeAgentUnsupported({
                        reason: "This node's mesh agent did not answer, so it cannot revoke a member.",
                    })
                }
                if (view.self.nodeId === memberId) {
                    return yield* new FleetInvalid({
                        reason: "A node cannot revoke itself. Revoke it from another member's console.",
                    })
                }
                if (!view.agents.some((agent) => agent.nodeId === memberId)) {
                    return yield* new FleetInvalid({
                        reason: `No mesh member ${memberId}`,
                    })
                }
                // The agent stops trusting the node: its agents and replicas are dropped from the roster and cannot be learned
                // again until unblocked. `reason` stays in the caller's audit trail, not in the agent's store.
                const blocked = yield* attempt(() => mesh.blockNode(memberId))
                if (blocked === null) {
                    return yield* new NodeAgentUnsupported({
                        reason: `Cannot revoke ${memberId} (${reason}): the node door did not answer.`,
                    })
                }
                return yield* this.getState()
            })
        }

        /** Never fails: a reconcile that cannot run is logged and the lanes stand. */
        reconcileDns(
            retired: readonly RetiredDnsName[] = []
        ): ReturnType<IngressEdgeServiceShape['reconcileDns']> {
            return Effect.gen({ self: this }, function* () {
                const lanesPort = yield* IngressLanesService
                const publicEdge = yield* PublicEdgeService
                const dns = yield* EdgeDnsService

                const lanes = yield* lanesPort.getLanes()
                const [, view] = yield* this.readDoor().pipe(
                    Effect.orElseSucceed(
                        (): readonly [
                            NodeDoorStatus | null,
                            NodeDoorView | null,
                        ] => [null, null]
                    )
                )
                // A private-lane A record needs an IP, so only nodes with an overlay contribute one.
                const meshAddresses = (view?.agents ?? []).flatMap((agent) =>
                    agent.overlay === null ? [] : [agent.overlay.meshAddress]
                )
                const publicEdgeRecords = yield* publicEdge.dnsRecords(lanes)
                const plans = planLaneDnsRecords(lanes, {
                    publicEdgeRecords,
                    meshAddresses,
                })
                const planned = new Set(
                    plans.map((plan) => plan.name.toLowerCase())
                )
                for (const old of retired) {
                    if (!planned.has(old.name.toLowerCase()))
                        yield* dns.removeRecords(old.name, old.accountId)
                }
                yield* dns.reconcile(plans)
            }).pipe(
                Effect.catch((error) =>
                    Effect.logWarning(
                        `DNS reconcile skipped: ${describe(error)}`
                    )
                )
            )
        }
    }
}

/**
 * The fleet contract's mesh view, built from what the node door actually knows.
 *
 * The door knows nodes (id, address, overlay identity), the kernel's peer handshakes, and nothing else: there is no
 * cluster id, no advertised CIDR, no door inventory, no gossip clock and no per-member signing key on this agent. Those
 * fields stay `null`/empty — a fabricated cluster id would be worse than an absent one.
 *
 * `link.path` has no "unknown" member: a peer the kernel holds with no handshake yet is `passive` ("it must dial us"),
 * which is exactly what a missing handshake means.
 */
function toMeshView(
    status: NodeDoorStatus | null,
    view: NodeDoorView | null
): MeshView {
    const peers = status?.peers ?? []
    return {
        available: view !== null,
        clusterId: null,
        cidr: null,
        address: status?.meshAddress ?? view?.self.overlay?.meshAddress ?? null,
        listenPort:
            status?.listenPort ?? view?.self.overlay?.listenPort ?? null,
        interfaceUp: status?.interfaceUp ?? false,
        members: (view?.agents ?? []).map((agent) => {
            const peer =
                peers.find((candidate) => candidate.nodeId === agent.nodeId) ??
                null
            const self = agent.nodeId === view?.self.nodeId
            return {
                memberId: agent.nodeId,
                name: agent.nodeId,
                kind: 'node' as const,
                // Its overlay address is what other nodes reach it on; the roster address is where its agent answers.
                address: agent.overlay?.meshAddress ?? agent.address,
                state: 'active' as const,
                self,
                labels: { ...agent.labels },
                endpoints: [{ kind: 'declared', address: agent.address }],
                link: {
                    path: self
                        ? ('self' as const)
                        : peer?.latestHandshakeAt != null
                          ? ('direct' as const)
                          : ('passive' as const),
                    endpoint: peer?.endpoint ?? agent.overlay?.endpoint ?? null,
                    latestHandshakeAt:
                        peer?.latestHandshakeAt == null
                            ? null
                            : new Date(peer.latestHandshakeAt).toISOString(),
                },
            }
        }),
        doors: [],
        lastGossipAt: null,
        lastError:
            view === null ? "This node's mesh agent did not answer." : null,
    }
}
