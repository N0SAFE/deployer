import { Effect } from 'effect'

import type {
    NewNodeConfigRow,
    NodeConfigRecordStore,
    NodeConfigRow,
} from '@deployer/node-state'

import {
    readNodeRecord,
    writeNodeRecord,
    type NodeRecordConfig,
    type NodeRecordOptions,
} from '../mesh/services/node-record.client'

/**
 * The node's own record, kept by its agent.
 *
 * The agent owns the record, so this is the first home the node-config repository consults: while it
 * answers, the local SQLite file is neither read nor written; when it stays silent (no agent, an agent
 * that predates the record, a timeout) the file remains the source, exactly as before.
 */
export function agentNodeRecords(
    options: NodeRecordOptions = {}
): NodeConfigRecordStore {
    return {
        read: () =>
            Effect.promise(() => readNodeRecord(options)).pipe(
                Effect.orElseSucceed(() => null),
                Effect.map((record) =>
                    record?.config
                        ? nodeConfigRowFromRecord(record.config)
                        : null
                )
            ),
        write: (row) =>
            Effect.promise(() =>
                writeNodeRecord(nodeRecordPatchFromRow(row), options)
            ).pipe(
                Effect.orElseSucceed(() => null),
                Effect.map((record) =>
                    record?.config
                        ? nodeConfigRowFromRecord(record.config)
                        : null
                )
            ),
    }
}

/**
 * The agent's record as the row the rest of the API reads. `id` is the singleton the local table has
 * always had; an unconfigured record (no platform id yet) answers nothing the file would not, so it is
 * reported as no answer and the file stays the source.
 */
export const nodeConfigRowFromRecord = (
    config: NodeRecordConfig
): NodeConfigRow | null =>
    config.nodeId === null
        ? null
        : {
              id: 1,
              nodeId: config.nodeId,
              strategy: config.strategy,
              setupState: config.setupState,
              deployerVersion: config.deployerVersion,
              upgradedAtVersion: config.upgradedAtVersion,
              meshUrlsSnapshot: [...config.meshUrlsSnapshot],
              databaseUrl: config.databaseUrl,
              databaseProvisioning: config.databaseProvisioning,
              configuredAt: config.configuredAt,
              peerServiceToken: config.peerServiceToken,
              peerServiceTokenExpiresAt: config.peerServiceTokenExpiresAt,
              updatedAt: config.updatedAt,
              meshSharedSecret: config.meshSharedSecret,
              meshSharedSecretUpdatedAt: config.meshSharedSecretUpdatedAt,
              platformSecret: config.platformSecret,
              platformSecretUpdatedAt: config.platformSecretUpdatedAt,
              platformSecretGeneration: config.platformSecretGeneration,
              platformSecretPrevious: config.platformSecretPrevious.map(
                  (entry) => ({ ...entry })
              ),
              scanConfig:
                  config.scanConfig === null
                      ? null
                      : {
                            autoScan: config.scanConfig.autoScan,
                            scanners: [...config.scanConfig.scanners],
                        },
              postSetupFlags:
                  config.postSetupFlags === null
                      ? null
                      : { ...config.postSetupFlags },
              swarmConfig:
                  config.swarmConfig === null
                      ? null
                      : {
                            ...config.swarmConfig,
                            joinAddrs: [...config.swarmConfig.joinAddrs],
                        },
          }

/** The row as a patch of the agent's record. `id`, `configuredAt` and `updatedAt` are the agent's to stamp. */
export const nodeRecordPatchFromRow = (
    row: NewNodeConfigRow
): Partial<NodeRecordConfig> => ({
    nodeId: row.nodeId,
    strategy: row.strategy,
    setupState: row.setupState ?? 'not_started',
    deployerVersion: row.deployerVersion ?? null,
    upgradedAtVersion: row.upgradedAtVersion ?? null,
    databaseUrl: row.databaseUrl ?? null,
    databaseProvisioning: row.databaseProvisioning ?? null,
    meshUrlsSnapshot: row.meshUrlsSnapshot ?? [],
    swarmConfig: row.swarmConfig ?? null,
    peerServiceToken: row.peerServiceToken ?? null,
    peerServiceTokenExpiresAt: row.peerServiceTokenExpiresAt ?? null,
    meshSharedSecret: row.meshSharedSecret ?? null,
    meshSharedSecretUpdatedAt: row.meshSharedSecretUpdatedAt ?? null,
    platformSecret: row.platformSecret ?? null,
    platformSecretUpdatedAt: row.platformSecretUpdatedAt ?? null,
    platformSecretGeneration: row.platformSecretGeneration ?? 1,
    platformSecretPrevious: row.platformSecretPrevious ?? [],
    scanConfig: row.scanConfig ?? null,
    postSetupFlags: row.postSetupFlags ?? null,
})
