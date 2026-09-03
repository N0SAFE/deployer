/**
 * Proof: listRepositoryBranches works — the exact path the listBranches
 * controller uses. Picks the first accessible repo of the first installation
 * and lists its branches via GET /repos/{owner}/{repo}/branches.
 *
 * Run with the app runtime:
 *   DATABASE_URL=postgres://deployer:deployer@172.18.0.1:32769/deployer \
 *     bun --bun run scripts/github-branches-proof.ts
 */
import { GitHubService } from "@/core/modules/git/github/services/github.service";
import { GlobalDatabaseService } from "@/core/modules/database/global/global-database.service";
import { eq } from "drizzle-orm";
import * as globalSchema from "@/config/drizzle/global/schema";

let failures = 0;
function assert(cond: boolean, label: string): void {
    if (cond) { console.log(`  ✅ ${label}`); } else { console.error(`  ❌ ${label}`); failures += 1; }
}

async function main() {
    console.log("GitHub branches proof (runtime)\n");

    const dbUrl = process.env.DATABASE_URL
        ?? "postgres://deployer:deployer@172.18.0.1:32769/deployer";
    const dbService = new GlobalDatabaseService();
    await dbService.initialize(dbUrl);
    const db = dbService.db;

    // 1. Load the stored app row.
    const rows = await db
        .select({
            id: globalSchema.githubApps.id,
            name: globalSchema.githubApps.name,
            appId: globalSchema.githubApps.appId,
            privateKey: globalSchema.githubApps.privateKey,
            clientId: globalSchema.githubApps.clientId,
            clientSecret: globalSchema.githubApps.clientSecret,
            webhookSecret: globalSchema.githubApps.webhookSecret,
            installationId: globalSchema.githubApps.installationId,
        })
        .from(globalSchema.githubApps)
        .where(eq(globalSchema.githubApps.isActive, true));
    assert(rows.length > 0, `stored active app(s): ${rows.length}`);
    if (rows.length === 0) { process.exit(1); }
    const app = rows[0]!;
    console.log(`  app name=${app.name} id=${app.id} appId=${app.appId} pk_len=${app.privateKey?.length ?? 0} installationId=${app.installationId ?? "(none)"}`);

    // 2. Register with the SAME credentials the controller uses.
    const service = new GitHubService();
    service.registerInstallation(app.id, {
        appId: app.appId!,
        privateKey: app.privateKey!,
        ...(app.clientId ? { clientId: app.clientId } : {}),
        ...(app.clientSecret ? { clientSecret: app.clientSecret } : {}),
        ...(app.webhookSecret ? { webhookSecret: app.webhookSecret } : {}),
    });

    // 3. Discover the installation.
    let installationId = Number(app.installationId);
    if (!Number.isFinite(installationId) || installationId <= 0) {
        const installs = await service.listInstallations(app.id);
        assert(installs.length > 0, "app has at least one installation");
        if (installs.length === 0) { process.exit(1); }
        installationId = installs[0]!.id;
    }
    console.log(`  using installationId=${installationId}`);

    // 4. Pick the first accessible repo.
    const repos = await service.listInstallationRepositories(app.id, installationId);
    assert(repos.length > 0, "installation returns repos");
    if (repos.length === 0) { process.exit(1); }
    const first = repos[0]!;
    const [owner, repoName] = first.full_name.split("/");
    console.log(`  testing repo: ${first.full_name} (default branch: ${first.default_branch ?? "(unknown)"})`);

    // 5. List branches — the exact controller call.
    try {
        const branches = await service.listRepositoryBranches(app.id, installationId, owner!, repoName!);
        console.log(`  branches found: ${branches.length}`);
        for (const b of branches.slice(0, 8)) {
            console.log(`    - ${b.name} (${b.protected ? "protected" : "open"}) sha=${b.sha.slice(0, 7)}`);
        }
        assert(branches.length > 0, "repository returns branches");
        assert(branches.some((b) => b.name === first.default_branch), "default branch is in the branch list");
    } catch (e) {
        assert(false, `listRepositoryBranches works: ${e instanceof Error ? e.message : e}`);
    }

    console.log(failures === 0 ? "\n🎉 ALL PASSED" : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
}
main();
