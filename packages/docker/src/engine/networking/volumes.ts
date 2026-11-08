import { Context, Effect } from 'effect'

import {
    dockerodeVolumeListResponseSchema,
    type DockerodeVolumeListResponse,
} from '@deployer/contracts-entities'

import { engineCall } from '../call'

import type { DockerError } from '../../errors/errors'
import type Docker from 'dockerode'

export type VolumesShape = {
    /** Creates the named volume unless it exists. A create that loses a race is not an error. */
    readonly ensure: (name: string) => Effect.Effect<void, DockerError>
    /** The named volume, or `DockerNotFound`. */
    readonly inspect: (
        name: string
    ) => Effect.Effect<Docker.VolumeInspectInfo, DockerError>
    /** Volumes on this engine (`GET /volumes`). */
    readonly list: () => Effect.Effect<
        DockerodeVolumeListResponse['Volumes'],
        DockerError
    >
}

/**
 * The one implementation of `VolumesShape`.
 *
 * Declared at module scope rather than as a class expression on the service: declaration emit
 * cannot describe the private members of an anonymous exported class (TS4094).
 */
class VolumesImpl implements VolumesShape {
    constructor(private readonly client: Docker) {}

    ensure(name: string): Effect.Effect<void, DockerError> {
        return Effect.gen({ self: this }, function* () {
            const exists = yield* engineCall(
                `inspect volume ${name}`,
                () => this.client.getVolume(name).inspect(),
                `volume '${name}'`
            ).pipe(
                Effect.as(true),
                Effect.catchTag('DockerNotFound', () => Effect.succeed(false))
            )
            if (exists) return
            yield* engineCall(`create volume ${name}`, () =>
                this.client.createVolume({ Name: name })
            ).pipe(Effect.ignore)
        })
    }

    inspect(name: string): Effect.Effect<Docker.VolumeInspectInfo, DockerError> {
        return engineCall(
            `inspect volume ${name}`,
            () => this.client.getVolume(name).inspect(),
            `volume '${name}'`
        )
    }

    list(): Effect.Effect<DockerodeVolumeListResponse['Volumes'], DockerError> {
        return Effect.gen({ self: this }, function* () {
            return yield* engineCall('list engine volumes', async () =>
                dockerodeVolumeListResponseSchema.parse(
                    await this.client.listVolumes()
                ).Volumes
            )
        })
    }
}

/** Engine volumes, as an Effect service. */
export class Volumes extends Context.Service<Volumes, VolumesShape>()(
    'docker/Volumes'
) {
    /** The implementation: it owns every member body and takes the engine client. */
    static readonly live = VolumesImpl
}
