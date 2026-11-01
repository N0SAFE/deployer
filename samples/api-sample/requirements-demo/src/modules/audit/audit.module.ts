import { Module } from "@nestjs/common";

import { declareModule } from "../../effect";

import { AuditTrail } from "./services/audit-trail.service";

/** A plain module that provides a service and exports nothing: its branch is closed to everyone else. */
@Module({ providers: [{ provide: AuditTrail, useValue: AuditTrail.live }] })
class AuditNestModule {}

export const AuditModule = declareModule(AuditNestModule, {
	provides: [AuditTrail],
	exports: [],
});
