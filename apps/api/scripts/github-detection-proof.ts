/**
 * Proof: getRepositoryFileContent + detection helpers work against a real repo.
 * Reads package.json / Dockerfile etc. and runs the same heuristics as the
 * detectRunner controller.
 */
import { GitHubService } from "@/core/modules/git/github/services/github.service";
import { GlobalDatabaseService } from "@/core/modules/database/global/global-database.service";
import { eq } from "drizzle-orm";
import * as globalSchema from "@/config/drizzle/global/schema";

let failures = 0;
function assert(cond: boolean, label: string): void {
    if (cond) { console.log(`  ✅ ${label}`); } else { console.error(`  ❌ ${label}`); failures += 1; }
}

/** Mirror of the controller's detection helpers (pure functions). */
type JsonRecord = Record<string, unknown>;
function safeParseJson(text: string): JsonRecord | null {
    try {
        const value: unknown = JSON.parse(text);
        return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
    } catch { return null; }
}
function asRecord(value: unknown): JsonRecord | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}
function getString(record: JsonRecord | undefined, key: string): string | undefined {
    const value = record?.[key];
    return typeof value === "string" ? value : undefined;
}
function detectNodeFramework(pkg: JsonRecord): string | undefined {
    const deps: JsonRecord = {};
    for (const source of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
        if (source && typeof source === "object" && !Array.isArray(source)) Object.assign(deps, source);
    }
    const keys = Object.keys(deps);
    if (keys.includes("next")) return "Next.js";
    if (keys.includes("@nestjs/core")) return "NestJS";
    if (keys.includes("vite")) return "Vite";
    if (keys.includes("express")) return "Express";
    return undefined;
}
function extractDockerfilePorts(text: string): number[] {
    const ports: number[] = [];
    for (const line of text.split("\n")) {
        const match = line.match(/^\s*EXPOSE\s+([\d\s]+)/i);
        if (match?.[1]) {
            for (const token of match[1].trim().split(/\s+/)) {
                const port = Number(token);
                if (Number.isInteger(port) && port > 0 && port <= 65535) ports.push(port);
            }
        }
    }
    return [...new Set(ports)];
}

async function main() {
    console.log("GitHub repo-content detection proof (runtime)\n");

    const dbUrl = process.env.DATABASE_URL
        ?? "postgres://deployer:deployer@172.18.0.1:32769/deployer";
    const dbService = new GlobalDatabaseService();
    await dbService.initialize(dbUrl);
    const db = dbService.db;

    const rows = await db.select({
        id: globalSchema.githubApps.id, appId: globalSchema.githubApps.appId,
        privateKey: globalSchema.githubApps.privateKey, clientId: globalSchema.githubApps.clientId,
        clientSecret: globalSchema.githubApps.clientSecret, webhookSecret: globalSchema.githubApps.webhookSecret,
        installationId: globalSchema.githubApps.installationId,
    }).from(globalSchema.githubApps).where(eq(globalSchema.githubApps.isActive, true));
    assert(rows.length > 0, `stored active app(s): ${rows.length}`);
    if (rows.length === 0) process.exit(1);
    const app = rows[0]!;
    const service = new GitHubService();
    service.registerInstallation(app.id, {
        appId: app.appId!, privateKey: app.privateKey!,
        ...(app.clientId ? { clientId: app.clientId } : {}),
        ...(app.clientSecret ? { clientSecret: app.clientSecret } : {}),
        ...(app.webhookSecret ? { webhookSecret: app.webhookSecret } : {}),
    });

    let installationId = Number(app.installationId);
    if (!Number.isFinite(installationId) || installationId <= 0) {
        const installs = await service.listInstallations(app.id);
        if (installs.length > 0) installationId = installs[0]!.id;
    }
    assert(Number.isFinite(installationId) && installationId > 0, `installation id available (${installationId})`);

    // 1. Root listing
    const root = new Set(await service.listRepositoryRoot(app.id, installationId, "N0SAFE", "livequestion"));
    console.log(`  root files (${root.size}): ${[...root].slice(0, 10).join(", ")}`);
    assert(root.size > 0, "root listing works");

    // 2. getRepositoryFileContent — existing file
    const readme = await service.getRepositoryFileContent(app.id, installationId, "N0SAFE", "livequestion", "README.md");
    assert(readme !== null && readme.length > 0, "getRepositoryFileContent returns content for existing file");
    console.log(`  README.md: ${readme?.slice(0, 80).replace(/\n/g, " ")}`);

    // 3. getRepositoryFileContent — missing file returns null (no throw)
    const missing = await service.getRepositoryFileContent(app.id, installationId, "N0SAFE", "livequestion", "does-not-exist.ts");
    assert(missing === null, "getRepositoryFileContent returns null for missing file");

    // 4. Dockerfile detection on a repo that has one — try a Node repo
    const repos = await service.listInstallationRepositories(app.id, installationId);
    const vite = repos.find((r) => r.full_name === "N0SAFE/vite");
    if (vite) {
        const [o, r] = vite.full_name.split("/");
        const pkgText = await service.getRepositoryFileContent(app.id, installationId, o!, r!, "package.json");
        const pkg = pkgText ? safeParseJson(pkgText) : null;
        console.log(`  N0SAFE/vite package.json → framework=${pkg ? detectNodeFramework(pkg) ?? "?" : "unreadable"}, scripts=${pkg ? Object.keys(asRecord(pkg.scripts) ?? {}).join(",") : "?"}`);
        assert(pkg !== null, "reads package.json from a Node repo");
        const dockerText = await service.getRepositoryFileContent(app.id, installationId, o!, r!, "Dockerfile");
        if (dockerText) {
            const ports = extractDockerfilePorts(dockerText);
            console.log(`  N0SAFE/vite Dockerfile EXPOSE → ${ports.join(",") || "(none)"}`);
        } else {
            console.log("  N0SAFE/vite has no root Dockerfile (expected for vite template)");
        }
    }

    console.log(failures === 0 ? "\n🎉 ALL PASSED" : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
}
main();
