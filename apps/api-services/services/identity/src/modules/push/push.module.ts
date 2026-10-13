import { Module } from "@nestjs/common";

import { PushController } from "./controllers/push.controller";
import { PushRepository } from "./repositories/push.repository";
import { PushService } from "./services/push.service";

/**
 * The push domain.
 *
 * Web-push subscriptions.
 *
 * Declares the three primitives and exports the SERVICE — not the repository.
 * A repository is this domain's private data access, and exporting it would let a
 * sibling domain couple to these tables, which is the cross-domain coupling the
 * split exists to remove.
 */
@Module({
	controllers: [PushController],
	providers: [PushService, PushRepository],
	exports: [PushService],
})
export class PushDomainModule {}
