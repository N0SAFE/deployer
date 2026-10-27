import { Module } from "@nestjs/common";
import { PlanetController } from "./planet.controller";
import { InMemoryPlanetRepository, PlanetRepository } from "./repositories/planet.repository";
import { PlanetService, PlanetServiceImpl } from "./services/planet.service";

/**
 * Normal NestJS module. Both types are registered identically, in the module
 * that consumes them: `{ provide: <Context.Service key>, useClass: impl }`.
 * Nothing is exported — the controller is the only consumer.
 */
@Module({
  controllers: [PlanetController],
  providers: [
    { provide: PlanetRepository, useClass: InMemoryPlanetRepository },
    { provide: PlanetService, useClass: PlanetServiceImpl },
  ],
})
export class PlanetModule {}
