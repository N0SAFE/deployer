import { Effect } from 'effect'

import { nodeDoorFromEnv } from '@deployer/mesh-client'
import { createModuleContext } from '@deployer/nest-effect'
import type { PgQueryable } from '@deployer/nest-schema/codecs/reseal'
import { EnvModule, EnvService } from '@deployer/shared/config/env/env.module'
import { GLOBAL_DATABASE_POOL } from '@deployer/shared/core/modules/database/database-connection'
import { storedSecretsReport } from '@deployer/shared/core/modules/secrets/stored-secrets'

import { SecretInventoryController } from './secret-inventory.controller'
import { ServiceClient } from '@deployer/shared/server'

import { SystemActorClients } from '@/core/ports/system-actor-clients.port'

import { SecretInventory } from './secret-inventory.service'
import { StepUpGateway } from './step-up.gateway'
import {
    SecretsDoor,
    StoredSecretsPort,
    type SecretsDoorShape,
    type StoredSecretsShape,
} from './secrets.ports'

export class SecretsModule extends createModuleContext(
    {
        imports: [EnvModule],
        controllers: [SecretInventoryController],
        providers: [
            {
                provide: SecretsDoor,
                // Looked up on each call, like every door: the agent can start after this service.
                useFactory: (env: EnvService): SecretsDoorShape => ({
                    fleetSecrets: () =>
                        Effect.promise(() => nodeDoorFromEnv(env).fleetSecrets()),
                    rotate: () =>
                        Effect.promise(() => nodeDoorFromEnv(env).rotatePlatformSecret()),
                    retire: (generation) =>
                        Effect.promise(() =>
                            nodeDoorFromEnv(env).retirePlatformSecret(generation)
                        ),
                }),
                inject: [EnvService],
            },
            {
                provide: StoredSecretsPort,
                // Counted across the shared database by a helper in `shared` (the columns belong to several services).
                useFactory: (pool: PgQueryable): StoredSecretsShape => ({
                    report: () => Effect.tryPromise(() => storedSecretsReport(pool)),
                }),
                inject: [GLOBAL_DATABASE_POOL],
            },
            { provide: SecretInventory, useValue: SecretInventory.live },
            { provide: StepUpGateway, useValue: StepUpGateway.live },
            // The clients that call a sibling service as the system: the app's `ServiceClient`, seen through this port.
            { provide: SystemActorClients, useExisting: ServiceClient },
        ],
    },
    SecretsDoor,
    StoredSecretsPort,
    SecretInventory,
    StepUpGateway,
    SystemActorClients
) {}
