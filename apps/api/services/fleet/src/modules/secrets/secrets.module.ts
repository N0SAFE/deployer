import { Effect } from 'effect'

import { nodeDoorFromEnv } from '@deployer/mesh-client'
import { createModuleContext } from '@deployer/nest-effect'
import { EnvModule, EnvService } from '@deployer/shared/config/env/env.module'

import { SecretInventoryController } from './secret-inventory.controller'
import { ServiceClient } from '@deployer/shared/server'

import { SystemActorClients } from '@/core/ports/system-actor-clients.port'

import { SecretInventory } from './secret-inventory.service'
import { StepUpGateway } from './step-up.gateway'
import { SecretsDoor, type SecretsDoorShape } from './secrets.ports'

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
            { provide: SecretInventory, useValue: SecretInventory.live },
            { provide: StepUpGateway, useValue: StepUpGateway.live },
            // The clients that call a sibling service as the system: the app's `ServiceClient`, seen through this port.
            { provide: SystemActorClients, useExisting: ServiceClient },
        ],
    },
    SecretsDoor,
    SecretInventory,
    StepUpGateway,
    SystemActorClients
) {}
