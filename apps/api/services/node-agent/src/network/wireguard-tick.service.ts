import { Context, Effect } from 'effect'

import { AgentStore, type AgentStoreError } from '../local/agent-store'
import { NodeAgents } from '../modules/mesh/services/node-agents.service'
import { NodeIdentity } from '../modules/mesh/services/node-identity.service'
import { AdvertisedAddress } from '../modules/mesh/services/roster-gossip.service'

import { chooseEndpoint, discoverReflexiveAddress } from './endpoint-discovery'
import { lanAddresses } from './host-addresses'
import {
    OVERLAY_PREFIX_LENGTH,
    OVERLAY_SALT_SECRET,
    OVERLAY_SELF_SECRET,
    WIREGUARD_KEEPALIVE_SECONDS,
    WIREGUARD_PRIVATE_KEY_SECRET,
    WIREGUARD_PUBLIC_KEY_SECRET,
    type OverlaySelf,
    settleOverlayAddress,
} from './overlay'
import { renderWireguardConfig, type PlannedPeer } from './wireguard'
import {
    type HostCommands,
    type WireguardCommandError,
    WireguardDriver,
    type WireguardPaths,
} from './wireguard.service'

/** Where this node's WireGuard listener answers: deployment configuration, not node state. */
export class OverlaySettings extends Context.Service<
    OverlaySettings,
    {
        readonly listenPort: number
        readonly declared: readonly string[]
        readonly stunServers: readonly string[]
    }
>()('node-agent/OverlaySettings') {}

/** A reflexive lookup is best-effort and off the critical path only barely: a pass must not wait on the internet. */
const REFLEXIVE_TIMEOUT_MS = 2_000

/** The last address a STUN server answered with: a flaky server must not drop the endpoint on a later pass. */
let cachedReflexive: string | null = null

export type WireguardConvergence =
    | {
          readonly applied: true
          readonly address: string
          readonly peers: number
          readonly salt: number
      }
    | { readonly applied: false; readonly reason: 'no-keys' | 'no-endpoint' }

/**
 * The endpoint this node advertises, discovered rather than only configured.
 *
 * STUN is asked only when the advertised URL, the declared addresses and the LAN all say nothing: a node with a usable
 * local address never waits on the internet, and a cached reflexive address survives a server that stops answering.
 */
const chooseSelfEndpoint = Effect.fn('WireguardTick.chooseSelfEndpoint')(
    function* (advertisedUrl: string, settings: OverlaySettings['Service']) {
        const lan = lanAddresses()
        const pick = (reflexive: string | null) =>
            chooseEndpoint({
                advertisedUrl,
                declared: settings.declared,
                lan,
                reflexive,
                listenPort: settings.listenPort,
            })

        const local = pick(cachedReflexive)
        if (local !== null || settings.stunServers.length === 0) return local

        const reflexive = yield* Effect.promise(() =>
            discoverReflexiveAddress(
                settings.stunServers,
                REFLEXIVE_TIMEOUT_MS
            ).catch(() => null)
        )
        if (reflexive === null) return null
        cachedReflexive = reflexive
        return pick(reflexive)
    }
)

/**
 * One convergence pass: this node's key pair, its overlay address and every peer's plan, applied to the kernel.
 *
 * Everything a pass decides comes from the store and the roster, so a pass can be replayed at any time and a node that
 * restarts converges on the same interface without a coordinator.
 */
export class WireguardTick extends Context.Service<
    WireguardTick,
    {
        readonly convergeOnce: () => Effect.Effect<
            WireguardConvergence,
            AgentStoreError | WireguardCommandError,
            | AgentStore
            | NodeIdentity
            | NodeAgents
            | AdvertisedAddress
            | OverlaySettings
            | WireguardDriver
            | HostCommands
            | WireguardPaths
        >
    }
>()('node-agent/WireguardTick') {
    static readonly live = class WireguardTickImpl {
        convergeOnce() {
            return Effect.gen(function* () {
                const store = yield* AgentStore
                const driver = yield* WireguardDriver
                const identity = yield* NodeIdentity
                const agents = yield* NodeAgents
                const advertised = yield* AdvertisedAddress
                const settings = yield* OverlaySettings

                const endpoint = yield* chooseSelfEndpoint(
                    advertised.address,
                    settings
                )
                if (endpoint === null)
                    return { applied: false, reason: 'no-endpoint' } as const

                const storedPrivateKey = yield* store.secret(
                    WIREGUARD_PRIVATE_KEY_SECRET
                )
                const storedPublicKey = yield* store.secret(
                    WIREGUARD_PUBLIC_KEY_SECRET
                )
                let privateKey: string
                let publicKey: string
                if (
                    storedPrivateKey === undefined ||
                    storedPublicKey === undefined
                ) {
                    const generated = yield* driver.generateKeypair()
                    yield* store.putSecret(
                        WIREGUARD_PRIVATE_KEY_SECRET,
                        generated.privateKey
                    )
                    yield* store.putSecret(
                        WIREGUARD_PUBLIC_KEY_SECRET,
                        generated.publicKey
                    )
                    privateKey = generated.privateKey
                    publicKey = generated.publicKey
                } else {
                    privateKey = storedPrivateKey
                    publicKey = storedPublicKey
                }

                const known = yield* agents.known()
                const others = known.flatMap((agent) =>
                    agent.nodeId !== identity.nodeId && agent.overlay !== null
                        ? [{ nodeId: agent.nodeId, overlay: agent.overlay }]
                        : []
                )
                const taken = new Map(
                    others.map((agent) => [
                        agent.nodeId,
                        agent.overlay.meshAddress,
                    ])
                )

                const storedSalt = Number(
                    yield* store.secret(OVERLAY_SALT_SECRET)
                )
                const salt = Number.isFinite(storedSalt) ? storedSalt : 0
                const settled = settleOverlayAddress(
                    identity.nodeId,
                    salt,
                    taken
                )
                if (settled.salt !== salt)
                    yield* store.putSecret(
                        OVERLAY_SALT_SECRET,
                        String(settled.salt)
                    )

                const peers: readonly PlannedPeer[] = others.map((agent) => ({
                    wireguardKey: agent.overlay.wireguardKey,
                    allowedIps: [`${agent.overlay.meshAddress}/32`],
                    endpoint: agent.overlay.endpoint,
                    persistentKeepaliveSeconds: WIREGUARD_KEEPALIVE_SECONDS,
                }))

                const self: OverlaySelf = {
                    wireguardKey: publicKey,
                    meshAddress: settled.address,
                    endpoint,
                    listenPort: settings.listenPort,
                }
                // Before the kernel: a node that crashes here still advertises what it will hold, not an address it does not.
                yield* store.putSecret(
                    OVERLAY_SELF_SECRET,
                    JSON.stringify(self)
                )

                yield* driver.ensureInterface(
                    settled.address,
                    OVERLAY_PREFIX_LENGTH
                )
                yield* driver.syncConfig(
                    renderWireguardConfig({
                        privateKey,
                        listenPort: settings.listenPort,
                        peers,
                    })
                )

                return {
                    applied: true,
                    address: settled.address,
                    peers: peers.length,
                    salt: settled.salt,
                } as const
            })
        }
    }
}
