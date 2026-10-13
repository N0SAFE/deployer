/**
 * Read the ownership registry at lint time.
 *
 * ── WHY READ THE FILE INSTEAD OF CONFIGURING A LIST ─────────────────────────
 * `packages/nest/schema/src/ownership/table-ownership.ts` already declares which
 * service owns each table and which owners may read a shared one. Duplicating that
 * in the eslint config — or generating an allowlist from it — means a second place
 * to keep in sync, and a schema edit would need a regeneration step. Reading the
 * file makes the boundary follow the registry automatically: claim a table, grant a
 * shared read, or add a table, and the next lint knows. No script, no drift.
 *
 * The registry is deliberately a pure data module (zero imports), so parsing it is
 * safe and needs no build output.
 */
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

export interface SchemaOwnership {
    /** `sql_table` -> owning service. */
    readonly tableOwnership: Readonly<Record<string, string>>;
    /** `sql_table` -> owners permitted to read it (the writer included). */
    readonly readers: Readonly<Record<string, readonly string[]>>;
    /** Tables every owner may use: platform config and the shared event outbox. */
    readonly multiOwner: ReadonlySet<string>;
    /** Schema symbol -> the owner directory that declares it. */
    readonly symbolOwner: Readonly<Record<string, string>>;
}

/** Walk up from the cwd so any package in the workspace can run the rule. */
function findRegistry(): string {
    let dir = process.cwd();
    for (let i = 0; i < 6; i++) {
        const candidate = path.join(dir, "packages/nest/schema/src/ownership/table-ownership.ts");
        try {
            readFileSync(candidate, "utf8");
            return candidate;
        } catch {
            dir = path.dirname(dir);
        }
    }
    throw new Error(
        "@deployer/config-eslint: could not find packages/nest/schema/src/ownership/table-ownership.ts " +
            `by walking up from ${process.cwd()}`,
    );
}

const withoutComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const readdir = (dir: string): string[] => {
    try {
        return readdirSync(dir);
    } catch {
        return [];
    }
};

let cached: SchemaOwnership | undefined;

export function loadSchemaOwnership(): SchemaOwnership {
    if (cached) return cached;

    const registryPath = findRegistry();
    const clean = withoutComments(readFileSync(registryPath, "utf8"));
    // Bound each declaration to its own block: TABLE_OWNERSHIP, INFRASTRUCTURE_TABLES and
    // SHARED_TABLES all contain `key: "..."`-shaped text, so an unbounded scan would read a
    // shared table's `writer`/`readers` fields as ownership entries.
    const block = (name: string, endMarker: string): string => {
        const start = clean.indexOf(name);
        if (start < 0) return "";
        const end = clean.indexOf(endMarker, start);
        return clean.slice(start, end < 0 ? undefined : end);
    };
    const ownershipSrc = block("TABLE_OWNERSHIP", "SHARED_TABLES");
    const sharedSrc = block("SHARED_TABLES", "export function");
    const infraSrc = block("INFRASTRUCTURE_TABLES", "TABLE_OWNERSHIP");

    const tableOwnership: Record<string, string> = {};
    for (const m of ownershipSrc.matchAll(/^\s{0,4}([a-z_][a-z0-9_]*):\s*"([a-z]+)",/gm)) {
        tableOwnership[m[1]] = m[2];
    }

    const readers: Record<string, string[]> = {};
    for (const m of sharedSrc.matchAll(
        /table:\s*"([a-z_]+)",\s*writer:\s*"([a-z]+)",\s*readers:\s*\[([^\]]*)\]/g,
    )) {
        readers[m[1]] = [
            m[2],
            ...m[3]
                .split(",")
                .map((s) => s.trim().replace(/"/g, ""))
                .filter(Boolean),
        ];
    }

    // Multi-owner: platform tables (app-wide config/versions) plus the infrastructure
    // entries, which carry a `reason` and are written by whoever needs them (the event
    // outbox is written by any service that publishes a domain event).
    const multiOwner = new Set<string>();
    for (const m of infraSrc.matchAll(/table:\s*"([a-z_]+)"/g)) multiOwner.add(m[1]);
    for (const [table, owner] of Object.entries(tableOwnership)) {
        if (owner === "platform") multiOwner.add(table);
    }

    // Ownership is physical: the directory a symbol is declared in IS its owner.
    const symbolOwner: Record<string, string> = {};
    const globalDir = path.join(path.dirname(path.dirname(registryPath)), "global");
    for (const owner of readdir(globalDir)) {
        for (const file of readdir(path.join(globalDir, owner))) {
            if (!file.endsWith(".ts")) continue;
            fromFile(globalDir, owner, file, symbolOwner);
        }
    }

    cached = { tableOwnership, readers, multiOwner, symbolOwner };
    return cached;
}

function fromFile(
    globalDir: string,
    owner: string,
    file: string,
    into: Record<string, string>,
): void {
    let src: string;
    try {
        src = withoutComments(readFileSync(path.join(globalDir, owner, file), "utf8"));
    } catch {
        return; // unreadable file: the rule simply will not know its symbols
    }
    for (const m of src.matchAll(
        /^\s*export\s+(?:const|enum|class|function|type|interface|abstract\s+class)\s+([A-Za-z_$][\w$]*)/gm,
    )) {
        into[m[1]] = owner;
    }
}
