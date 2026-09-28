import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { READINESS_PROBE } from '@/core/readiness/readiness.port';
import { HealthController } from './controllers/health.controller';
import { HealthService } from './services/health.service';
import { HealthRepository } from './repositories/health.repository';
import { ReadinessService } from './services/readiness.service';
import { ReadinessStateService } from './services/readiness-state.service';
import { ReadinessIndicators } from './indicators/readiness.indicators';
import { DatabaseModule } from '../../core/modules/database/database.module';
import { ConfigurationCoreModule } from '@/core/modules/configuration/configuration-core.module';
import { MeshCoreModule } from '@/core/modules/mesh/mesh-core.module';
import { SwarmCoreModule } from "@/core/modules/swarm/swarm.module";

@Module({
  // SwarmCoreModule and MeshCoreModule are NOT @Global, so the readiness
  // indicators' dependencies (SwarmParticipationService, and the mesh cluster
  // repository) must be imported explicitly here. Importing them does not pull
  // the global Postgres in: SwarmCoreModule depends only on NodeStateModule
  // (pure local SQLite), which is what keeps the readiness probe answerable
  // before setup has provisioned anything.
  imports: [
    DatabaseModule,
    ConfigurationCoreModule,
    // `logger: false` because a not-yet-ready platform is a DESIGNED state, not
    // a failure. `HealthCheckService.check()` logs at ERROR and then throws,
    // before the controller can present the result — and `/health/ready` is
    // polled by compose every 15s for the whole of onboarding, so the built-in
    // log emitted an ERROR every 15 seconds describing correct behaviour and
    // buried the real failures.
    //
    // The genuine signal is not lost: `ReadinessStateService` publishes a
    // transition whenever the aggregated state CHANGES, so the platform going
    // green (or going degraded) is still logged — once per event, not per probe.
    TerminusModule.forRoot({ logger: false }),
    MeshCoreModule,
    SwarmCoreModule,
  ],
  controllers: [HealthController],
  providers: [
    HealthService,
    HealthRepository,
    ReadinessStateService,
    ReadinessService,
    // Bind the core-owned PORT to this module's implementation. `useExisting`
    // (not `useClass`) keeps ONE instance: the readiness-state service shares
    // the probe's cached snapshot, so a second instance would double the
    // subscriptions for no benefit.
    { provide: READINESS_PROBE, useExisting: ReadinessService },
    ReadinessIndicators,
  ],
  exports: [HealthService, HealthRepository, ReadinessService, ReadinessStateService],
})
export class HealthModule {}
