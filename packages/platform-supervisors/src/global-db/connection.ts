/** The connection fields reported to consumers, parsed from a Postgres DSN. */
export type PostgresConnectionInfo = {
	readonly url: string;
	/** The DSN with the password masked. */
	readonly urlSafe: string;
	readonly host: string;
	readonly port: number | null;
	readonly database: string;
	readonly user: string;
};

const UNKNOWN = { host: "unknown", port: null, database: "unknown", user: "unknown" } as const;

/** Parses a Postgres DSN. An empty or malformed one is reported as-is with unknown parts: consumers gate on it. */
export function parsePostgresUrl(url: string): PostgresConnectionInfo {
	if (url === "") return { url, urlSafe: "", ...UNKNOWN };
	try {
		const parsed = new URL(url);
		const port = parsed.port !== "" ? Number(parsed.port) : null;
		return {
			url,
			urlSafe: url.replace(/:[^@/]+@/, ":***@"),
			host: parsed.hostname !== "" ? parsed.hostname : "localhost",
			port: port !== null && Number.isInteger(port) && port >= 1 ? port : null,
			database: parsed.pathname.replace(/^\//, "") || "postgres",
			user: parsed.username !== "" ? parsed.username : "unknown",
		};
	} catch {
		return { url, urlSafe: url, ...UNKNOWN };
	}
}
