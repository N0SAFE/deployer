import { Module } from "@nestjs/common";
import { HealthModule } from "@deployer/shared/server";

import { HealthController } from "./controllers/health.controller";

/**
 * The health domain.
 *
 * ── WHY THERE IS NO SERVICE OR REPOSITORY HERE ──────────────────────────────
 * Every check in this domain is a REAL probe of an external resource, and those
 * live in `@deployer/shared`'s indicator set (`HealthModule`) — because the same
 * probes are what every other service needs for its own readiness. Re-declaring
 * them per service is how two services end up disagreeing about whether the
 * database is up.
 *
 * So this module is the TRANSPORT: it registers the contract controller and
 * receives the registry. A repository/service pair would exist only to wrap
 * calls that already have an owner.
 */
@Module({
	// `platform` = memory + disk + database + migrations + redis. This service is
	// the platform's health surface, so it declares the FULL set: it is the one
	// place an operator looks, and a partial answer here is misleading.
	imports: [HealthModule.forRoot({ indicators: "platform" })],
	controllers: [HealthController],
})
export class HealthDomainModule {}
