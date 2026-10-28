import {
	Global,
	Module,
	type DynamicModule,
	type InjectionToken,
	type ModuleMetadata,
	type OptionalFactoryDependency,
	type Provider,
} from "@nestjs/common";
import { LOCAL_DATABASE_CLIENT, LOCAL_DATABASE_CONNECTION } from "@deployer/nest-database-core/database-connection";
import type { LocalDatabaseOptions } from "@deployer/node-state";

import { LOCAL_DATABASE_OPTIONS_TOKEN, LocalDatabaseHost } from "./local-database.host";
import { LocalDatabaseService } from "./local-database.service";

export type LocalDatabaseModuleOptions = LocalDatabaseOptions;

export type LocalDatabaseModuleAsyncOptions = {
	imports?: NonNullable<ModuleMetadata["imports"]>;
	inject?: (InjectionToken | OptionalFactoryDependency)[];
	useFactory: (...deps: never[]) => LocalDatabaseModuleOptions | Promise<LocalDatabaseModuleOptions>;
};

/**
 * Registers the local SQLite database in a Nest context, over the Effect `LocalDatabase` in
 * `@deployer/node-state`. The APP supplies the path (and the migrations directory unless it owns the
 * schema some other way); the module reads no environment variable and derives no path.
 */
@Global()
@Module({})
export class LocalDatabaseModule {
	static forRoot(options: LocalDatabaseModuleOptions): DynamicModule {
		return {
			module: LocalDatabaseModule,
			providers: [{ provide: LOCAL_DATABASE_OPTIONS_TOKEN, useValue: options }, ...LocalDatabaseModule.providers()],
			exports: LocalDatabaseModule.exports(),
		};
	}

	static forRootAsync(options: LocalDatabaseModuleAsyncOptions): DynamicModule {
		return {
			module: LocalDatabaseModule,
			imports: options.imports ?? [],
			providers: [
				{ provide: LOCAL_DATABASE_OPTIONS_TOKEN, useFactory: options.useFactory, inject: options.inject ?? [] },
				...LocalDatabaseModule.providers(),
			],
			exports: LocalDatabaseModule.exports(),
		};
	}

	private static providers(): Provider[] {
		return [
			LocalDatabaseHost,
			{ provide: LOCAL_DATABASE_CLIENT, useFactory: (host: LocalDatabaseHost) => host.database.client, inject: [LocalDatabaseHost] },
			{ provide: LOCAL_DATABASE_CONNECTION, useFactory: (host: LocalDatabaseHost) => host.database.db, inject: [LocalDatabaseHost] },
			{ provide: LocalDatabaseService, useFactory: (host: LocalDatabaseHost) => new LocalDatabaseService(host.database.db), inject: [LocalDatabaseHost] },
		];
	}

	private static exports(): DynamicModule["exports"] {
		return [LocalDatabaseService, LOCAL_DATABASE_CONNECTION, LOCAL_DATABASE_CLIENT, LocalDatabaseHost];
	}
}
