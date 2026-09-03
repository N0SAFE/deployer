/**
 * Proof: a stored GitHub App's credentials (appId + privateKey) can
 * authenticate to GitHub, discover its installation, and list repos —
 * the EXACT path the listRepos controller uses.
 *
 * Run with the app runtime:
 *   DATABASE_URL=postgres://deployer:deployer@172.18.0.1:32769/deployer \
 *     bun --bun run scripts/github-installation-proof.ts
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
    console.log("GitHub app credentials proof (runtime)\n");

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

    // 3. Discover the installation via GET /app/installations (eachInstallation).
    let installs: Array<{ id: number; accountLogin: string }> = [];
    try {
        installs = await service.listInstallations(app.id);
        console.log(`  installations: ${JSON.stringify(installs)}`);
        assert(installs.length > 0, "app has at least one installation");
    } catch (e) {
        assert(false, `listInstallations works: ${e instanceof Error ? e.message : e}`);
        process.exit(1);
    }
    if (installs.length === 0) {
        console.log(`\n❌ The app is genuinely NOT installed on any GitHub account.`);
        console.log(`   Install it here: https://github.com/apps/${encodeURIComponent(app.name ?? app.appId!)}/installations/new`);
        console.log(`   (or open the app's settings → Install). Then re-run this proof.`);
        process.exit(1);
    }

    const installationId = installs[0]!.id;

    // 4. List repos for that installation — the exact controller call.
    try {
        const repos = await service.listInstallationRepositories(app.id, installationId);
        console.log(`  repos found: ${repos.length}`);
        for (const r of repos.slice(0, 5)) {
            console.log(`    - ${r.full_name} (${r.default_branch})`);
        }
        assert(repos.length > 0, "installation returns repos");
    } catch (e) {
        assert(false, `listInstallationRepositories works: ${e instanceof Error ? e.message : e}`);
    }

    console.log(failures === 0 ? "\n🎉 ALL PASSED" : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
}
main();
