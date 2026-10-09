/** What `LocalDatabaseModule.forRoot` needs from the consuming app. */
export interface LocalDatabaseModuleOptions {
    /**
     * Where the SQLite file lives.
     *
     * REQUIRED, and deliberately so. The package previously defaulted to
     * `/app/data/local.db` and also read `process.env.NODE_LOCAL_DB_PATH`
     * itself — an app convention leaking into a shared primitive, which made
     * the package unusable (and untestable) outside a container.
     */
    databasePath: string;
    /**
     * Directory holding the app's SQLite migration files.
     *
     * The MIGRATIONS ARE THE APP'S DATA: they describe this app's local tables.
     * The package previously derived the path with a relative `new URL(...)`,
     * which silently pointed at a non-existent directory the moment the module
     * moved into a package — the runner then logged "directory not found,
     * skipping" and booted with an UNMIGRATED schema. Taking it as an option is
     * what makes the failure impossible instead of silent.
     */
    migrationsDir?: string;
}

/**
 * Internal token carrying the resolved options to the connection factory.
 *
 * Both registration paths bind it — `useValue` in the sync path, `useFactory`
 * in the async one — so the provider list below is identical either way.
 */
export const LOCAL_DATABASE_OPTIONS_TOKEN = "LOCAL_DATABASE_OPTIONS" as const;
