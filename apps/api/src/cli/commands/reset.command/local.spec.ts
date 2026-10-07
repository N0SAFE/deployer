import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database as BunSqliteDatabase } from "bun:sqlite";
import * as localSchema from "@repo/nest-schema/local";

import { resetLocal } from "./local";

/**
 * The reset drops every table — including the migration STATE table.
 *
 * That last part is the whole point of this spec. The previous implementation
 * named three tables by hand and listed `__drizzle_migrations`, which is
 * DRIZZLE'S GLOBAL POSTGRES TABLE and has never existed in this SQLite file. The
 * real state table is `local_migrations`, so it survived every reset: the schema
 * was empty and the state said "all migrations applied", which made the next boot
 * skip every migration and start with no tables. The failure was one boot away
 * from the command that caused it, which is why it went unnoticed.
 *
 * A table the state table does NOT cover is included deliberately: a hardcoded
 * list would have missed it, `sqlite_master` cannot.
 */
describe("resetLocal", () => {
    function createDatabase() {
        const sqlite = new BunSqliteDatabase(":memory:");
        return { sqlite, db: drizzle(sqlite, { schema: localSchema }) };
    }

    function tables(sqlite: BunSqliteDatabase): string[] {
        return (
            sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
                name: string;
            }[]
        ).map((row) => row.name);
    }

    it("drops the migration state table along with every schema table", () => {
        const { sqlite, db } = createDatabase();
        sqlite.run("CREATE TABLE node_config (id integer PRIMARY KEY)");
        sqlite.run("CREATE TABLE cluster_nodes (node_id text PRIMARY KEY)");
        // The real state table, under the name the module actually uses.
        sqlite.run("CREATE TABLE local_migrations (id integer PRIMARY KEY, name text NOT NULL UNIQUE)");
        sqlite.run("INSERT INTO local_migrations (name) VALUES ('0000_a.sql')");

        resetLocal(db);

        expect(tables(sqlite)).toEqual([]);
        sqlite.close();
    });

    it("leaves an empty database usable (no throw, nothing to drop)", () => {
        const { sqlite, db } = createDatabase();
        sqlite.run("CREATE TABLE node_config (id integer PRIMARY KEY)");
        resetLocal(db);

        // Idempotent: the second call has nothing left to drop.
        expect(() => {
            resetLocal(db);
        }).not.toThrow();
        expect(tables(sqlite)).toEqual([]);
        sqlite.close();
    });

    it("drops tables that reference each other regardless of order", () => {
        const { sqlite, db } = createDatabase();
        // `node_config` is created FIRST but referenced BY `cluster_node`, so a
        // drop in `sqlite_master` order would fail with foreign keys enforced.
        db.run("PRAGMA foreign_keys=ON");
        sqlite.run("CREATE TABLE node_config (id integer PRIMARY KEY)");
        sqlite.run(
            "CREATE TABLE cluster_node (id integer PRIMARY KEY, node_config_id integer REFERENCES node_config(id))",
        );

        expect(() => {
            resetLocal(db);
        }).not.toThrow();

        expect(tables(sqlite)).toEqual([]);
        sqlite.close();
    });
});
