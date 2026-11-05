import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'

/**
 * Interfaces that never carry a peer's traffic: loopback, Docker bridges and veths (per-host), virtual bridges the
 * platform did not create, and the overlay interface itself (a node must not advertise the mesh through itself).
 */
const IGNORED_INTERFACE =
    /^(lo|docker\d*|docker_gwbridge|br-|veth|virbr|vxlan|flannel|cni|cali|tun|tap|wg|deployer-mesh)/

/**
 * The LAN addresses a door may bind, sorted so the choice is stable across ticks (a door that moved interface every
 * pass would be recreated forever). Pure over `networkInterfaces()`, so a test needs no host.
 */
export function lanAddresses(
    interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()
): readonly string[] {
    const found: string[] = []
    for (const [name, infos] of Object.entries(interfaces)) {
        if (IGNORED_INTERFACE.test(name)) continue
        for (const info of infos ?? []) {
            if (
                info.family !== 'IPv4' ||
                info.internal ||
                info.address.startsWith('169.254.')
            )
                continue
            found.push(info.address)
        }
    }
    return found.sort((left, right) => left.localeCompare(right))
}
