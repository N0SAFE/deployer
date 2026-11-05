import { Module } from '@nestjs/common'
import { Effect } from 'effect'

import { declareModule } from '@deployer/nest-effect'

import { GLOBAL_DATABASE_POOL } from '../../core/modules/database/database-connection'
import { SERVICE_READINESS, type ServiceReadinessPort } from '../service-health'

import {
    makePreflightService,
    PreflightService,
    type PreflightServiceShape,
} from './preflight.service'
import { WAIT_FOR_DEPENDENCIES, type PreflightPolicy } from './runner'

import type { PreflightDependency } from './types'
import type { Pool } from 'pg'

/**
 * Wires dependency preflight for one app.
 *
 * `forRoot` takes the dependency set because it is a property of the APP, not of
 * the framework: the BFF needs the database and Redis, a pure compute service
 * needs nothing, and only the app's author knows which. Declaring it here means
 * a service that forgets to require the database is a visible omission rather
 * than a silent one that fails its first request.
 *
 * Binds `SERVICE_READINESS` to the preflight verdict, so `/health/ready` and the
 * boot gate are the SAME answer by construction — they cannot disagree.
 */
@Module({})
export class PreflightModule {
    static forRoot(options: {
        readonly dependencies: readonly PreflightDependency[]
        /**
         * Omit to WAIT for dependencies (a boot). Pass `REPORT_ONLY` when the caller
         * wants an immediate answer and will act on the report itself.
         */
        readonly policy?: PreflightPolicy
    }) {
        return declareModule(
            {
                module: PreflightModule,
                // ── GLOBAL, BECAUSE THE READINESS PORT MUST BE VISIBLE EVERYWHERE ────
                // The comment below has always claimed that "`SERVICE_READINESS` and
                // `/health/ready` cannot disagree by construction". They could, and did,
                // because `exports` only reaches modules that IMPORT this one — and
                // `ServiceHealthModule` — the module that owns the `/health/ready`
                // ROUTE — declares the controller without importing `PreflightModule`.
                //
                // Inside that module `SERVICE_READINESS` was therefore unresolvable.
                // `@Optional()` turned that into a silent `null`, and the controller's
                // `?? true` fallback then answered **ready** forever. Measured on a
                // stack whose database had never been migrated:
                //
                //   [preflight] preflight attempt 317 not ready — retrying in 2000ms
                //   GET /health/ready -> 200 {"status":"ready"}
                //   docker ps         -> Up (healthy)
                //
                // So compose marked five services healthy while every one of them was
                // still refusing to serve, and `bff` started on top of them. The
                // dependency retry loop was invisible to the orchestrator precisely
                // because the endpoint meant to report it could not see the verdict.
                //
                // `global: true` is the right fix rather than adding an import to every
                // health module: there are six apps and one controller, the port is a
                // platform-wide concern, and the failure mode of a missing import is
                // SILENT (a green probe), not a boot error. `useExisting` still keeps
                // ONE instance, so the route and the boot gate read the same verdict.
                global: true,
                providers: [
                    {
                        provide: PreflightService,
                        // The pool is optional: an app that declares a database dependency without binding one gets a clear report.
                        useFactory: (pool: Pool | undefined) =>
                            makePreflightService({
                                dependencies: options.dependencies,
                                policy: options.policy ?? WAIT_FOR_DEPENDENCIES,
                                pool,
                            }),
                        inject: [
                            { token: GLOBAL_DATABASE_POOL, optional: true },
                        ],
                    },
                    // The readiness port IS the preflight verdict. `useExisting` keeps ONE
                    // instance, so `/health/ready` cannot report a stale answer from a
                    // second copy that never ran the checks.
                    {
                        provide: SERVICE_READINESS,
                        // The health controller is a Promise edge; the answer needs no services, so it runs bare.
                        useFactory: (
                            preflight: PreflightServiceShape
                        ): ServiceReadinessPort => ({
                            isReady: () =>
                                Effect.runPromise(preflight.isReady()),
                        }),
                        inject: [PreflightService],
                    },
                ],
                exports: [PreflightService, SERVICE_READINESS],
            },
            // Dynamic by nature: the dependency set is the app's. Nothing Effect-shaped crosses this boundary — the
            // providers are plain classes and symbol tokens — so the empty claim is explicit on purpose.
            { provides: [], exports: [], global: true }
        )
    }
}
