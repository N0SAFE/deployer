import { createGlobalModule } from "@deployer/nest-effect";
import { DatabaseModule } from "@deployer/shared/core/modules/database/database.module";
import { GlobalDatabaseService } from "@deployer/shared/core/modules/database/services/global-database.service";

import { DatabasePort } from "./database.port";

/**
 * The app's `DatabasePort`, global.
 *
 * Repositories are constants that `yield* DatabasePort` when a method runs (the `serviceOver` convention), so the port
 * must be visible to every module's scoped request context — exactly what `@Global()` means. It was a root `providers`
 * entry before the request context became per-module: a root provider is invisible to a child module, and the first
 * request would fail with `Service not found: fleet/DatabasePort`.
 */
export const DatabasePortModule = createGlobalModule({
	imports: [DatabaseModule],
	providers: [{ provide: DatabasePort, useExisting: GlobalDatabaseService }],
	exports: [DatabasePort],
});
