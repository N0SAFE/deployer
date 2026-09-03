/**
 * Proof: enhanced compose-file detection helpers (whole-repo search,
 * prod-priority ranking, recommendations) against the real N0SAFE/deployer
 * repository. Fetches the full git tree via `gh api` (no GitHub App needed).
 *
 * Usage: gh auth status && bun --bun scripts/compose-detection-proof.ts
 */
import { execSync } from "node:child_process";

let failures = 0;
function assert(cond: boolean, label: string): void {
    if (cond) { console.log(`  ✅ ${label}`); } else { console.error(`  ❌ ${label}`); failures += 1; }
}

/** Fetch the recursive git tree of a repo via the GitHub CLI. */
function fetchTree(owner: string, repo: string): string[] {
    const raw = execSync(
        `gh api "repos/${owner}/${repo}/git/trees/HEAD?recursive=1" --jq '.tree[] | select(.type == "blob") | .path'`,
        { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 },
    );
    return raw.split("\n").filter(Boolean);
}

// ─── Mirror of the controller's detection helpers (pure functions) ─────────

type ComposeKind = "prod" | "dev" | "base" | "override";

function rankComposeFile(path: string): { score: number; kind: ComposeKind } {
    const lower = path.toLowerCase();
    if (lower.includes("prod")) return { score: 0, kind: "prod" };
    if (lower.includes("override")) return { score: 3, kind: "override" };
    if (lower.includes("dev")) return { score: 2, kind: "dev" };
    return { score: 1, kind: "base" };
}

function findComposeFiles(allFiles: string[]): Array<{ path: string; kind: ComposeKind }> {
    const isCompose = (p: string): boolean => {
        const base = p.split("/").pop()?.toLowerCase() ?? "";
        return (
            base === "docker-compose.yml" ||
            base === "docker-compose.yaml" ||
            base === "compose.yml" ||
            base === "compose.yaml" ||
            /^docker-compose\..*\.ya?ml$/.test(base) ||
            /^compose\..*\.ya?ml$/.test(base)
        );
    };
    const matches = allFiles.filter(isCompose);
    const ranked = matches
        .map((path) => ({ path, ...rankComposeFile(path) }))
        .sort((a, b) => {
            if (a.score !== b.score) return a.score - b.score;
            const aDepth = a.path.split("/").length;
            const bDepth = b.path.split("/").length;
            return aDepth - bDepth;
        });
    return ranked.map(({ path, kind }) => ({ path, kind }));
}

function findDockerfile(allFiles: string[], composePath?: string): string | undefined {
    const dockerfiles = allFiles.filter((p) => {
        const base = p.split("/").pop()?.toLowerCase() ?? "";
        return base === "dockerfile" || /^dockerfile(\..+)?$/.test(base);
    });
    if (dockerfiles.length === 0) return undefined;
    if (composePath) {
        const dir = composePath.includes("/") ? composePath.slice(0, composePath.lastIndexOf("/")) : "";
        const near = dockerfiles.find((p) => (dir ? p.startsWith(`${dir}/`) : !p.includes("/")));
        if (near) return near;
    }
    return dockerfiles.sort((a, b) => a.split("/").length - b.split("/").length)[0];
}

type RecommendationKind =
    | "ci" | "dockerfile" | "env-example" | "kubernetes" | "terraform"
    | "makefile" | "package-manager" | "ignore-file";

/** Byte-for-byte mirror of the controller's buildRecommendations. */
function buildRecommendations(
    allFiles: string[],
    rootFiles: Set<string>,
): Array<{ kind: RecommendationKind; path: string; label?: string }> {
    const recommendations: { kind: RecommendationKind; path: string; label?: string }[] = [];
    const paths = new Set(allFiles);
    const find = (name: string) => allFiles.find((p) => p.endsWith(name));

    // CI pipelines.
    const ci = find(".github/workflows/ci.yml") ?? find(".github/workflows/ci.yaml") ?? find(".github/workflows/deploy.yml") ?? find(".gitlab-ci.yml") ?? find(".circleci/config.yml") ?? find("azure-pipelines.yml");
    if (ci) recommendations.push({ kind: "ci", path: ci, label: "CI pipeline" });

    // Dockerfile (if not already the builder) — match any variant like the
    // findDockerfile helper (Dockerfile, Dockerfile.prod, Dockerfile.api.dev …).
    const df = allFiles.find((p) => {
        const base = p.split("/").pop()?.toLowerCase() ?? "";
        return base === "dockerfile" || /^dockerfile(\..+)?$/.test(base);
    });
    if (df) recommendations.push({ kind: "dockerfile", path: df, label: "Dockerfile" });

    // Env examples.
    const env = find(".env.example") ?? find(".env.sample") ?? find(".env.dist");
    if (env) recommendations.push({ kind: "env-example", path: env, label: "Environment example" });

    // Kubernetes manifests.
    const k8s = allFiles.find((p) => p.includes("k8s") && (p.endsWith(".yaml") || p.endsWith(".yml"))) ?? find("deployment.yaml") ?? find("helm/Chart.yaml");
    if (k8s) recommendations.push({ kind: "kubernetes", path: k8s, label: "Kubernetes manifests" });

    // IaC.
    const tf = find("terraform/main.tf") ?? find("main.tf") ?? find("infra/main.tf");
    if (tf) recommendations.push({ kind: "terraform", path: tf, label: "Terraform config" });

    // Makefile.
    if (paths.has("Makefile")) recommendations.push({ kind: "makefile", path: "Makefile", label: "Makefile" });

    // Package manager lockfile (root-scoped) — tells the wizard which PM to use.
    const pm = ["pnpm-workspace.yaml", "yarn.lock", "package-lock.json", "bun.lock", "bun.lockb", "npm-shrinkwrap.json", "deno.json"]
        .find((p) => rootFiles.has(p));
    if (pm) recommendations.push({ kind: "package-manager", path: pm, label: "Package manager" });

    // Ignore file — prefer root-scoped so the user knows it applies repo-wide.
    const ignore = rootFiles.has(".dockerignore") ? ".dockerignore" : (rootFiles.has(".gitignore") ? ".gitignore" : undefined);
    if (ignore) recommendations.push({ kind: "ignore-file", path: ignore, label: ignore === ".dockerignore" ? "Docker ignore" : "Git ignore" });

    return recommendations;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const owner = "N0SAFE";
    const repo = "deployer";
    console.log(`Compose detection proof — ${owner}/${repo}\n`);

    console.log("1. Fetching full repo tree (whole-repo search) …");
    const allFiles = fetchTree(owner, repo);
    console.log(`   tree files: ${allFiles.length}`);
    assert(allFiles.length > 50, "tree is large enough to be meaningful");

    const rootFiles = new Set(allFiles.filter((p) => !p.includes("/")));

    console.log("\n2. findComposeFiles — whole-repo search + prod priority …");
    const candidates = findComposeFiles(allFiles);
    console.log(`   found ${candidates.length} compose files:`);
    for (const c of candidates) {
        console.log(`     ${c.kind.padEnd(8)} ${c.path}`);
    }
    assert(candidates.length >= 2, "multiple compose files found across the repo");
    const top = candidates[0];
    assert(top !== undefined, "has a top-ranked compose file");
    assert(top.kind === "prod", `prod compose ranked first (got ${top.kind}: ${top.path})`);
    assert(
        candidates.length > 1,
        "multiple candidates proposed (user-selectable, not just the winner)",
    );
    const nonProd = candidates.filter((c) => c.kind !== "prod");
    console.log(`   non-prod candidates: ${nonProd.length} (${nonProd.map((c) => c.path).join(", ") || "none"})`);

    console.log("\n3. findDockerfile — near compose first, else shortest …");
    const dockerfile = findDockerfile(allFiles, top?.path);
    console.log(`   Dockerfile: ${dockerfile ?? "(none)"}`);
    assert(dockerfile !== undefined, "Dockerfile found");

    console.log("\n4. buildRecommendations — other useful files …");
    const recommendations = buildRecommendations(allFiles, rootFiles);
    console.log(`   ${recommendations.length} recommendations:`);
    for (const r of recommendations) {
        console.log(`     ${r.kind.padEnd(16)} ${r.path}${r.label ? `  (${r.label})` : ""}`);
    }
    assert(recommendations.some((r) => r.kind === "ci"), "CI pipeline recommended");
    assert(recommendations.some((r) => r.kind === "dockerfile"), "Dockerfile recommended");
    assert(recommendations.some((r) => r.kind === "env-example"), "env-example recommended");
    assert(recommendations.some((r) => r.kind === "ignore-file"), "ignore file recommended");
    assert(recommendations.some((r) => r.kind === "package-manager"), "package manager recommended");

    console.log(`\n${failures === 0 ? "🎉 ALL ASSERTIONS PASSED" : `❌ ${failures} assertion(s) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error("proof failed:", err);
    process.exit(1);
});
