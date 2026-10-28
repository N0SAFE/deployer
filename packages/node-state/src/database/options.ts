/** What the app supplies; the package reads no environment and derives no path. */
export type LocalDatabaseOptions = {
	/**
	 * Where the SQLite file lives. Required: a default path (or reading an env var here) made the
	 * package unusable outside a container.
	 */
	readonly databasePath: string;
	/**
	 * The directory holding the app's migration files. They are the app's data: they describe its
	 * local tables, and the app owns them so `drizzle-kit` resolves them from its own config. Passing
	 * none is supported (migrations are skipped, loudly), not a mistake.
	 */
	readonly migrationsDir?: string;
};
