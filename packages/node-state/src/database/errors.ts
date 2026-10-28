import { domainError } from "@deployer/effect-core";

/** The local SQLite database could not be opened, migrated or queried. */
export class LocalDatabaseError extends domainError("LocalDatabaseError", "dependency_missing")<{
	readonly operation: string;
	readonly reason: string;
}>() {
	override publicMessage() {
		return `Local database ${this.operation} failed`;
	}
}

/** The local database has no table by that name yet, which a fresh install reports until it is migrated. */
export const isMissingTable = (error: unknown, table: string): boolean =>
	error instanceof Error && error.message.includes(`no such table: ${table}`);

/** A write the database accepted could not be read back, which means another writer changed the row. */
export class NodeStateConflict extends domainError("NodeStateConflict", "conflict")<{
	readonly reason: string;
}>() {
	override publicMessage() {
		return this.reason;
	}
}
