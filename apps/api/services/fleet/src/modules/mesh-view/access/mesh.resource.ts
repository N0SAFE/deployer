import { defineResource } from '@deployer/nest-effect'

/** The mesh as a thing access is asked about: its roster, replicas and topology. Platform-wide. */
export const Mesh = defineResource('mesh', { scope: 'platform' })

/** The swarm's join tokens live under the cluster: issuing one reveals the credential a new node joins with. */
export const Cluster = defineResource('cluster', { scope: 'platform' })
