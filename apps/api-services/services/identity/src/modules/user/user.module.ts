import { Module } from "@nestjs/common";

import { UserController } from "./controllers/user.controller";
import { UserRepository } from "./repositories/user.repository";
import { UserService } from "./services/user.service";

/**
 * The user domain.
 *
 * Users: profile, listing, roles.
 *
 * Declares the three primitives and exports the SERVICE — not the repository.
 * A repository is this domain's private data access, and exporting it would let a
 * sibling domain couple to these tables, which is the cross-domain coupling the
 * split exists to remove.
 */
@Module({
	controllers: [UserController],
	providers: [UserService, UserRepository],
	exports: [UserService],
})
export class UserDomainModule {}
