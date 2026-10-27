import { Context } from "effect";
import type { GlobalDatabaseService } from "@deployer/shared/core/modules/database/services/global-database.service";

/** Effect-facing database capability; aliased to the Nest `GlobalDatabaseService`. */
export type DatabaseShape = {
	readonly db: GlobalDatabaseService["db"];
}

/** Effect key = NestJS token, provided once by the root module. */
export class DatabasePort extends Context.Service<DatabasePort, DatabaseShape>()(
	"identity/DatabasePort",
) {}
