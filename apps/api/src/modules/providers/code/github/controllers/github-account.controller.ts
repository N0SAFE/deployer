/**
 * GitHub Apps Controller
 *
 * CRUD for GitHub App configurations stored in the database.
 * Managed through the web UI settings at runtime.
 */
import { Controller, Logger } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { appContract } from "@repo/api-contracts";
import type { RunnerDetectionHints } from "@repo/api-contracts";
import { standardErrorOptions } from "@repo/orpc-utils";
import z from "zod/v4";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { GitHubService } from "@/core/modules/git/github/services/github.service";
import { ReachabilityService } from "@/core/modules/reachability/services/reachability.service";
import { PublicAccessPointService } from "@/core/modules/reachability/services/public-access-point.service";
import { parseComposeServices } from "@/core/modules/git/github/services/compose-parser";
import { GithubAppsRepository } from "../repositories/github-apps.repository";

@Controller()
export class GitHubAppsController {
    private readonly logger = new Logger(GitHubAppsController.name);

    constructor(
        private readonly githubAppsRepository: GithubAppsRepository,
        private readonly gitHubService: GitHubService,
        private readonly reachabilityService: ReachabilityService,
        private readonly publicAccessPointService: PublicAccessPointService,
    ) {}

    /**
     * Ensure a GitHub App row is registered in the in-memory GitHubService.
     * The GitHubService keeps a Map keyed by DB row id; it is lost on restart,
     * so every repo/installation operation must (re-)register the app first.
     * Idempotent — registerInstallation overwrites the cached App instance.
     */
    private ensureAppRegistered(row: {
        id: string;
        appId: string | null;
        privateKey: string | null;
        clientId: string | null;
        clientSecret: string | null;
        webhookSecret: string | null;
    }): void {
        // PAT rows (appId === "pat") have no app credentials — skip registration.
        if (row.appId === "pat" || !row.appId || !row.privateKey) {
            return;
        }
        this.gitHubService.registerInstallation(row.id, {
            appId: row.appId,
            privateKey: row.privateKey,
            ...(row.clientId ? { clientId: row.clientId } : {}),
            ...(row.clientSecret ? { clientSecret: row.clientSecret } : {}),
            ...(row.webhookSecret ? { webhookSecret: row.webhookSecret } : {}),
        });
    }

    /** Select full app row by DB id (for registration + installation access). */
    private findAppRow(id: string) {
        return this.githubAppsRepository.findById(id);
    }

    @Implement(appContract.providers.code.github.list)
    list() {
        return implement(appContract.providers.code.github.list)
            .use(requireAuth())
            .handler(async () => {
                const rows = await this.githubAppsRepository.list();

                return {
                    apps: rows.map((r) => ({
                        id: r.id,
                        name: r.name,
                        appId: r.appId,
                        clientId: r.clientId,
                        isActive: r.isActive,
                        createdAt: r.createdAt.toISOString(),
                        updatedAt: r.updatedAt.toISOString(),
                    })),
                    total: rows.length,
                };
            });
    }

    @Implement(appContract.providers.code.github.create)
    create() {
        return implement(appContract.providers.code.github.create)
            .use(requireAuth())
            .handler(async ({ input, errors }) => {
                const row = await this.githubAppsRepository.create({
                    name: input.name,
                    appId: input.appId,
                    clientId: input.clientId,
                    clientSecret: input.clientSecret,
                    privateKey: input.privateKey,
                    webhookSecret: input.webhookSecret,
                    installationId: null,
                    isActive: true,
                });

                if (!row) {
                    throw errors.BAD_REQUEST(
                        standardErrorOptions("validation", "Failed to create GitHub App"),
                    );
                }

                return {
                    id: row.id,
                    name: row.name,
                    appId: row.appId,
                    clientId: row.clientId,
                    isActive: row.isActive,
                    createdAt: row.createdAt.toISOString(),
                    updatedAt: row.updatedAt.toISOString(),
                };
            });
    }

    @Implement(appContract.providers.code.github.update)
    update() {
        return implement(appContract.providers.code.github.update)
            .use(requireAuth())
            .handler(async ({ input, errors }) => {
                const body = input.body;
                const values: Partial<typeof import("@/config/drizzle/global/schema").githubApps.$inferInsert> = {};
                if (body?.name) values.name = body.name;
                if (body?.clientId) values.clientId = body.clientId;
                if (body?.clientSecret) values.clientSecret = body.clientSecret;
                if (body?.privateKey) values.privateKey = body.privateKey;
                if (body?.webhookSecret) values.webhookSecret = body.webhookSecret;

                const row = await this.githubAppsRepository.updateById(input.params.id, values);

                if (!row) {
                    throw errors.NOT_FOUND(
                        standardErrorOptions("not_found", "GitHub App not found"),
                    );
                }

                return {
                    id: row.id,
                    name: row.name,
                    appId: row.appId,
                    clientId: row.clientId,
                    isActive: row.isActive,
                    createdAt: row.createdAt.toISOString(),
                    updatedAt: row.updatedAt.toISOString(),
                };
            });
    }

    @Implement(appContract.providers.code.github.delete)
    delete() {
        return implement(appContract.providers.code.github.delete)
            .use(requireAuth())
            .handler(async ({ input }) => {
                await this.githubAppsRepository.deleteById(input.params.id);
                return { success: true };
            });
    }

    // ─── Self-check ─────────────────────────────────────────────────────────

    @Implement(appContract.providers.code.github.selfCheck)
    selfCheck() {
        return implement(appContract.providers.code.github.selfCheck)
            .use(requireAuth())
            .handler(async () => {
                // The public access point comes from the CORE service (global
                // relay) — requested on demand, live-checked, then returned.
                const state = await this.publicAccessPointService.getAccessPoint();
                if (!state.configured || !state.publicUrl) {
                    return {
                        reachable: false,
                        publicUrl: null,
                        localUrl: "http://localhost:3005",
                        error: state.error ?? "No public access point configured for this node. Set a public IP or hostname (or enable the tunnel) in System → Node Network & Reachability first.",
                    };
                }
                return {
                    reachable: state.reachable === true,
                    publicUrl: state.publicUrl,
                    localUrl: "http://localhost:3005",
                    ...(state.reachable === true && state.latencyMs != null
                        ? { latencyMs: state.latencyMs }
                        : { error: state.error ?? "Public access point is not reachable" }),
                };
            });
    }

    // ─── Manifest (create a GitHub App from GitHub's manifest flow) ─────────

    @Implement(appContract.providers.code.github.manifestInit)
    manifestInit() {
        return implement(appContract.providers.code.github.manifestInit)
            .use(requireAuth())
            .handler(async ({ input, errors }) => {
                // The GitHub App manifest flow registers a callback URL on this
                // node — requires a configured AND reachable public access point.
                const state = await this.publicAccessPointService.getAccessPoint();
                if (!state.configured || !state.publicUrl) {
                    throw errors.BAD_REQUEST(
                        standardErrorOptions(
                            "validation",
                            state.error ?? "GitHub App manifest registration requires a configured public access point for this node.",
                        ),
                    );
                }
                if (state.reachable !== true) {
                    throw errors.BAD_REQUEST(
                        standardErrorOptions(
                            "validation",
                            `GitHub App manifest registration requires the public access point to be reachable: ${state.error ?? "not reachable"}`,
                        ),
                    );
                }
                const base = state.publicUrl.replace(/\/+$/, "");

                // The browser lands on the WEB APP callback page (which holds
                // the session cookie) — the web app then POSTs the code to this
                // protected API. GitHub's cross-site redirect never carries the
                // API session cookie, so a direct API redirect would 401.
                const redirectBase = input.redirectUrl?.replace(/\/+$/, "");
                const callbackUrl = redirectBase ?? `${base}/github/manifest/callback`;

                const stateToken = crypto.randomUUID();
                const appName = `deployer-${Math.random().toString(36).slice(2, 10)}`;

                // After the user INSTALLS the app (choosing all/subset repos),
                // GitHub redirects to this setup URL with `installation_id`.
                // The install-callback page is a SIBLING of the manifest callback
                // page (…/github/install-callback), so derive it by replacing the
                // trailing "/callback" — never append to the callback URL.
                // We embed appName so the callback page can correlate back.
                const webCallbackBase = redirectBase
                    ? redirectBase.replace(/\/callback$/, "")
                    : `${base}/github/manifest/callback`.replace(/\/callback$/, "");
                const installCallbackUrl = `${webCallbackBase}/install-callback?appName=${encodeURIComponent(appName)}`;

                // The GitHub App manifest definition — POSTed to GitHub so the
                // create-app page is PREFILLED (instead of a blank manual form).
                const manifest = {
                    name: appName,
                    url: base,
                    hook_attributes: { url: `${base}/webhooks/github` },
                    redirect_url: callbackUrl,
                    setup_url: installCallbackUrl,
                    setup_on_update: true,
                    callback_urls: [callbackUrl],
                    description: "Automatically created by the Deployer platform — source code integration.",
                    public: false,
                    default_events: ["push", "pull_request", "pull_request_review", "issue_comment"],
                    default_permissions: {
                        contents: "read",
                        metadata: "read",
                        pull_requests: "read",
                        checks: "read",
                        statuses: "read",
                        issues: "read",
                        repository_hooks: "write",
                    },
                };
                const target = `https://github.com/settings/apps/new?state=${encodeURIComponent(stateToken)}&redirect_uri=${encodeURIComponent(callbackUrl)}`;

                return {
                    url: target,
                    target,
                    manifest: JSON.stringify(manifest),
                    reachable: true,
                    publicUrl: state.publicUrl,
                    appName,
                };
            });
    }

    @Implement(appContract.providers.code.github.manifestCallback)
    manifestCallback() {
        return implement(appContract.providers.code.github.manifestCallback)
            .use(requireAuth())
            .handler(async ({ input, errors }) => {
                const result = await this.gitHubService.createFromManifestCode(input.code);
                const row = await this.githubAppsRepository.create({
                    name: result.name,
                    appId: String(result.id),
                    clientId: result.client_id,
                    clientSecret: result.client_secret,
                    privateKey: result.pem,
                    webhookSecret: result.webhook_secret,
                    installationId: null,
                    isActive: true,
                });
                if (!row) {
                    throw errors.BAD_REQUEST(
                        standardErrorOptions("validation", "Failed to persist GitHub App from manifest"),
                    );
                }
                return {
                    id: row.id,
                    name: row.name,
                    slug: result.slug,
                    appId: row.appId,
                    clientId: row.clientId,
                    isActive: row.isActive,
                    createdAt: row.createdAt.toISOString(),
                    updatedAt: row.updatedAt.toISOString(),
                    htmlUrl: result.html_url,
                };
            });
    }

    // ─── Installation callback (user installed the app, picked repos) ─────

    @Implement(appContract.providers.code.github.installCallback)
    installCallback() {
        return implement(appContract.providers.code.github.installCallback)
            .use(requireAuth())
            .handler(async ({ input, errors }) => {
                // Guard: the installation id must be numeric (GitHub returns a number).
                const parsed = Number(input.installationId);
                if (!Number.isFinite(parsed) || parsed <= 0) {
                    throw errors.BAD_REQUEST(
                        standardErrorOptions("validation", `Invalid installation id: ${input.installationId}`),
                    );
                }
                // Match by the unique appName embedded in the setup URL.
                const updated = await this.githubAppsRepository.setInstallationByName(input.appName, String(parsed));
                if (!updated) {
                    throw errors.NOT_FOUND(
                        standardErrorOptions("not_found", `GitHub App not found by name: ${input.appName}`),
                    );
                }
                this.logger.log(`GitHub App ${updated.appId} installation recorded: ${String(parsed)}`);
                return { success: true, appName: input.appName, installationId: String(parsed) };
            });
    }

    // ─── Create from PAT ────────────────────────────────────────────────────

    @Implement(appContract.providers.code.github.createFromPat)
    createFromPat() {
        return implement(appContract.providers.code.github.createFromPat)
            .use(requireAuth())
            .handler(async ({ input, errors }) => {
                const row = await this.githubAppsRepository.create({
                    name: input.name,
                    appId: "pat",
                    clientId: "pat",
                    clientSecret: input.pat,
                    privateKey: "",
                    webhookSecret: "",
                    installationId: null,
                    isActive: true,
                });
                if (!row) {
                    throw errors.BAD_REQUEST(
                        standardErrorOptions("validation", "Failed to create GitHub App from PAT"),
                    );
                }
                return {
                    id: row.id,
                    name: row.name,
                    appId: row.appId,
                    clientId: row.clientId,
                    isActive: row.isActive,
                    createdAt: row.createdAt.toISOString(),
                    updatedAt: row.updatedAt.toISOString(),
                };
            });
    }

    // ─── OAuth (server-side flow for an existing app) ───────────────────────

    @Implement(appContract.providers.code.github.oauthInit)
    oauthInit() {
        return implement(appContract.providers.code.github.oauthInit)
            .use(requireAuth())
            .handler(async ({ input, errors }) => {
                const app = await this.githubAppsRepository.findClientIdById(input.params.appId);
                if (!app?.clientId) {
                    throw errors.NOT_FOUND(
                        standardErrorOptions("not_found", "GitHub App not found"),
                    );
                }
                const state = `${app.id}:${crypto.randomUUID()}`;
                // The OAuth redirect URI must point at THIS node's public access
                // point (core service, global relay) — never env vars.
                const accessPoint = await this.publicAccessPointService.getAccessPoint();
                if (!accessPoint.configured || !accessPoint.publicUrl) {
                    throw errors.BAD_REQUEST(
                        standardErrorOptions(
                            "validation",
                            accessPoint.error ?? "GitHub OAuth requires a configured public access point for this node.",
                        ),
                    );
                }
                if (accessPoint.reachable !== true) {
                    throw errors.BAD_REQUEST(
                        standardErrorOptions(
                            "validation",
                            `GitHub OAuth requires the public access point to be reachable: ${accessPoint.error ?? "not reachable"}`,
                        ),
                    );
                }
                const publicUrl = accessPoint.publicUrl;
                const redirectUri = `${publicUrl}/github/oauth/callback`;
                const url = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(app.clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=repo%20read:org`;
                return { url, state };
            });
    }

    @Implement(appContract.providers.code.github.oauthCallback)
    oauthCallback() {
        return implement(appContract.providers.code.github.oauthCallback)
            .use(requireAuth())
            .handler(async ({ input, errors }) => {
                const app = await this.githubAppsRepository.findClientCredentialsById(input.appId);
                if (!app) {
                    throw errors.NOT_FOUND(
                        standardErrorOptions("not_found", "GitHub App not found"),
                    );
                }
                // OAuth code exchange returns a USER token (scopes on the
                // installing user), NOT an installation id. Persisting it as
                // `installationId` corrupts the repo-listing path — instead we
                // only verify the exchange succeeded. The installation id is
                // captured by the `installation` webhook (or auto-discovered
                // by listRepos via the app credentials).
                const token = await this.gitHubService.exchangeCodeForToken(app.id, input.code);
                if (!token.access_token) {
                    throw errors.BAD_REQUEST(
                        standardErrorOptions("validation", "GitHub OAuth code exchange returned no token"),
                    );
                }
                return { success: true, installationId: undefined };
            });
    }

    // ─── Repo listing (scoped to a specific provider app when given) ─────

    @Implement(appContract.providers.code.github.listRepos)
    listRepos() {
        return implement(appContract.providers.code.github.listRepos)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const providerAppId = input.query?.providerAppId;
                const rows = await this.githubAppsRepository.findProviderApps(providerAppId);

                // Use the first app that has an installation id, or the first app.
                const app = rows.find((a) => a.installationId) ?? rows[0];
                if (!app) return { repos: [] };

                // The in-memory GitHubService app cache is lost on restart —
                // (re-)register this app with its credentials before using it.
                this.ensureAppRegistered(app);

                let installationId = Number(app.installationId);

                // If the DB has no installation id yet, try to discover it
                // directly from GitHub using the app credentials. This covers
                // apps created before the installation webhook was wired, and
                // any delivery gaps. Persist the discovered id.
                if (!Number.isFinite(installationId) || installationId <= 0) {
                    try {
                        const installations = await this.gitHubService.listInstallations(app.id);
                        const first = installations[0];
                        if (first) {
                            installationId = first.id;
                            await this.githubAppsRepository.updateById(app.id, {
                                installationId: String(first.id),
                            });
                            this.logger.log(`Discovered GitHub installation ${String(first.id)} for app ${app.appId}`);
                        }
                    } catch (error) {
                        this.logger.warn(`Could not discover GitHub installation for app ${app.appId}: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }

                if (!Number.isFinite(installationId) || installationId <= 0) {
                    return {
                        repos: [],
                        _meta: { installed: false, appId: app.appId, appName: app.name, message: "This GitHub App is not yet installed on any repositories." },
                    };
                }
                const repos = await this.gitHubService.listInstallationRepositories(app.id, installationId);
                return {
                    repos: repos.map((r) => ({
                        id: r.id,
                        name: r.name,
                        full_name: r.full_name,
                        description: r.description,
                        html_url: r.html_url,
                        default_branch: r.default_branch,
                        language: r.language,
                        private: r.private,
                        updated_at: new Date().toISOString(),
                    })),
                    _meta: { installed: true, appId: app.appId, appName: app.name },
                };
            });
    }

    // ─── Branch listing for a repo (uses the app's installation) ──────────

    @Implement(appContract.providers.code.github.listBranches)
    listBranches() {
        return implement(appContract.providers.code.github.listBranches)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const providerAppId = input.query?.providerAppId;
                const rows = await this.githubAppsRepository.findProviderApps(providerAppId);
                const app = rows.find((a) => a.installationId) ?? rows[0];
                if (!app) return { owner: input.params.owner, repo: input.params.repo, branches: [] };

                this.ensureAppRegistered(app);

                let installationId = Number(app.installationId);
                if (!Number.isFinite(installationId) || installationId <= 0) {
                    // Try to auto-discover the installation (same as listRepos).
                    try {
                        const installations = await this.gitHubService.listInstallations(app.id);
                        const first = installations[0];
                        if (first) {
                            installationId = first.id;
                            await this.githubAppsRepository.updateById(app.id, {
                                installationId: String(first.id),
                            });
                        }
                    } catch {
                        // fall through — no branches
                    }
                }

                if (!Number.isFinite(installationId) || installationId <= 0) {
                    return { owner: input.params.owner, repo: input.params.repo, branches: [] };
                }

                const branches = await this.gitHubService.listRepositoryBranches(
                    app.id,
                    installationId,
                    input.params.owner,
                    input.params.repo,
                );
                return { owner: input.params.owner, repo: input.params.repo, branches };
            });
    }

    // ─── Runner detection (heuristic based on repo files) ───────────────────

    @Implement(appContract.providers.code.github.detectRunner)
    detectRunner() {
        return implement(appContract.providers.code.github.detectRunner)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const providerAppId = input.query?.providerAppId;

                const rows = await this.githubAppsRepository.findProviderApps(providerAppId);
                const app = rows.find((a) => a.installationId) ?? rows[0];
                if (!app) {
                    return { detected: [], defaultBuilder: null };
                }

                // Ensure the app is registered in the in-memory GitHubService cache.
                this.ensureAppRegistered(app);

                let installationId = Number(app.installationId);
                if (!Number.isFinite(installationId) || installationId <= 0) {
                    try {
                        const installations = await this.gitHubService.listInstallations(app.id);
                        const first = installations[0];
                        if (first) installationId = first.id;
                    } catch {
                        // fall through — no detection possible
                    }
                }
                if (!Number.isFinite(installationId) || installationId <= 0) {
                    return { detected: [], defaultBuilder: null };
                }

                const { owner, repo } = input.params;
                let builder: string | null = null;
                const hints: RunnerDetectionHints = {};

                try {
                    const rootFiles = new Set(await this.gitHubService.listRepositoryRoot(app.id, installationId, owner, repo));
                    const readFile = (path: string) => this.gitHubService.getRepositoryFileContent(app.id, installationId, owner, repo, path);

                    // ── Node.js: package.json → framework, scripts, engines ──
                    if (rootFiles.has("package.json")) {
                        const pkgText = await readFile("package.json");
                        const pkg = pkgText ? parsePackageJson(pkgText) : null;
                        if (pkg) {
                            hints.language = "node";
                            hints.startCommand = pkg.scripts?.start;
                            hints.buildCommand = pkg.scripts?.build;
                            hints.nodeVersion = pkg.engines?.node;
                            hints.framework = detectNodeFramework(pkg);
                            hints.packageManager = detectPackageManager(rootFiles);
                        }
                    }

                    // ── Docker: Dockerfile / compose → ports, paths, builder ──
                    // 1. Search the WHOLE repo for compose files (prod first).
                    const allFiles = await this.gitHubService.listRepositoryFiles(app.id, installationId, owner, repo);
                    const composeCandidates = findComposeFiles(allFiles);

                    // 2. Pick the compose file: an explicit `composeFile` query
                    //    (user switched candidates) wins, else the top-ranked one.
                    const requested = input.query?.composeFile;
                    const composeName = (requested && composeCandidates.some((c) => c.path === requested))
                        ? requested
                        : (composeCandidates[0]?.path ?? undefined);

                    // 3. Dockerfile: prefer the one at the compose file's dir, else root.
                    const dockerfileName = findDockerfile(allFiles, composeName);

                    if (composeName) {
                        const text = await readFile(composeName);
                        builder = "docker-compose";
                        hints.composeFile = composeName;
                        hints.dockerfilePath = dockerfileName ?? undefined;
                        hints.composeCandidates = composeCandidates.map((c) => ({
                            path: c.path,
                            kind: c.kind,
                        }));
                        if (text) {
                            const ports = extractComposePorts(text);
                            if (ports.length > 0) hints.ports = ports;
                            hints.rootPath = extractComposeRootPath(text);
                            // Full compose parser: handles `include:`, `extends:`,
                            // interpolation and all list/map forms. Follows
                            // relative includes via readFile (GitHub API-backed).
                            const dir = composeName.includes("/") ? composeName.slice(0, composeName.lastIndexOf("/")) : "";
                            const services = await parseComposeServices(
                                text,
                                (path: string) => readFile(path),
                                dir,
                                {},
                            );
                            if (services.length > 0) hints.composeServices = services;
                            // Attach per-candidate service counts.
                            hints.composeCandidates = hints.composeCandidates.map((c) => ({
                                ...c,
                                serviceCount: c.path === composeName ? services.length : undefined,
                            }));
                        }
                    } else if (dockerfileName) {
                        const text = await readFile(dockerfileName);
                        builder = "dockerfile";
                        hints.dockerfilePath = dockerfileName;
                        if (text) {
                            const ports = extractDockerfilePorts(text);
                            if (ports.length > 0) hints.ports = ports;
                            const baseImage = extractDockerfileBase(text);
                            if (baseImage) hints.framework = baseImage;
                        }
                    } else if (rootFiles.has("package.json")) {
                        // Node project without a Dockerfile → nixpacks/buildpack.
                        builder = "nixpacks";
                        hints.rootPath = "/";
                        hints.buildContext = ".";
                        const pkgText = await readFile("package.json");
                        const pkg = pkgText ? parsePackageJson(pkgText) : null;
                        if (pkg) {
                            const devPort = extractDevPort(pkg);
                            if (devPort) hints.ports = [devPort];
                        }
                    } else if (rootFiles.has("requirements.txt") || rootFiles.has("pyproject.toml") || rootFiles.has("Pipfile")) {
                        builder = "nixpacks";
                        hints.language = "python";
                        if (rootFiles.has("pyproject.toml")) {
                            const text = await readFile("pyproject.toml");
                            if (text) hints.startCommand = extractPythonStart(text);
                        } else if (rootFiles.has("requirements.txt")) {
                            const text = await readFile("requirements.txt");
                            if (text) hints.startCommand = extractPythonStartFromRequirements(text);
                        }
                    } else if (rootFiles.has("go.mod")) {
                        builder = "nixpacks";
                        hints.language = "go";
                        hints.startCommand = "go run .";
                    } else if (rootFiles.has("Cargo.toml")) {
                        builder = "nixpacks";
                        hints.language = "rust";
                        hints.startCommand = "cargo run";
                    } else if (rootFiles.has("index.html")) {
                        builder = "static";
                        hints.outputDir = ".";
                        hints.indexFile = "index.html";
                        hints.startCommand = undefined;
                    } else if (rootFiles.has("worker.js") || rootFiles.has("queue.yml")) {
                        builder = "worker-runtime";
                        hints.language = "node";
                    }

                    // ── Recommendations: other useful files found in the repo ──
                    const recommendations = buildRecommendations(allFiles, rootFiles);
                    if (recommendations.length > 0) hints.recommendations = recommendations;

                    // Fill in sensible defaults for the shared fields.
                    hints.rootPath = hints.rootPath ?? "/";
                    hints.buildContext = hints.buildContext ?? ".";
                } catch {
                    // fall through to default
                }

                const detected = builder
                    ? [{
                        builderId: builder,
                        name: builder,
                        description: "Auto-detected from repository contents",
                        confidence: 0.8,
                        config: hints,
                    }]
                    : [];
                return { detected, defaultBuilder: builder };
            });
    }
}

/* ─── Pure detection helpers (no IO) ───────────────────────────────────── */

/**
 * Subset of package.json used for runtime detection. package.json content is
 * external data — parsed through Zod, never trusted. Each section uses
 * `.catch(undefined)` so one malformed section degrades on its own instead of
 * invalidating the whole file.
 */
const stringRecordSchema = z.record(z.string(), z.string());

export const packageJsonSchema = z
    .object({
        name: z.string().optional(),
        scripts: stringRecordSchema.optional().catch(undefined),
        engines: stringRecordSchema.optional().catch(undefined),
        dependencies: stringRecordSchema.optional().catch(undefined),
        devDependencies: stringRecordSchema.optional().catch(undefined),
        peerDependencies: stringRecordSchema.optional().catch(undefined),
    })
    .passthrough();

type PackageJson = z.infer<typeof packageJsonSchema>;

/** Parse a package.json payload through the Zod schema. Null when not an object. */
function parsePackageJson(text: string): PackageJson | null {
    try {
        const parsed = packageJsonSchema.safeParse(JSON.parse(text));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

/** Detect the web framework from package.json dependencies. */
function detectNodeFramework(pkg: PackageJson): string | undefined {
    const deps = new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
    ]);
    if (deps.has("next")) return "Next.js";
    if (deps.has("@nestjs/core")) return "NestJS";
    if (deps.has("nuxt")) return "Nuxt";
    if (deps.has("astro")) return "Astro";
    if (deps.has("vite")) return "Vite";
    if (deps.has("express")) return "Express";
    if (deps.has("fastify")) return "Fastify";
    if (deps.has("@remix-run/react")) return "Remix";
    if (deps.has("svelte")) return "Svelte";
    if (deps.has("vue")) return "Vue";
    return undefined;
}

/** Infer the package manager from the presence of lockfiles. */
function detectPackageManager(rootFiles: Set<string>): string | undefined {
    if (rootFiles.has("bun.lockb") || rootFiles.has("bun.lock")) return "bun";
    if (rootFiles.has("pnpm-lock.yaml")) return "pnpm";
    if (rootFiles.has("yarn.lock")) return "yarn";
    if (rootFiles.has("package-lock.json")) return "npm";
    return undefined;
}

/** Extract a dev port from package.json scripts/dev (common for web apps). */
function extractDevPort(pkg: PackageJson): number | undefined {
    const dev = pkg.scripts?.dev ?? pkg.scripts?.start;
    if (!dev) return undefined;
    const match = /(?:--port|--listen|-p)[ =]?(\d{2,5})/.exec(dev);
    if (match?.[1]) {
        const port = Number(match[1]);
        if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
    }
    const bare = /\b(\d{4,5})\b/.exec(dev);
    if (bare?.[1]) {
        const port = Number(bare[1]);
        if (Number.isInteger(port) && port >= 3000 && port <= 65535) return port;
    }
    return undefined;
}

/** Extract EXPOSE ports from a Dockerfile. */
function extractDockerfilePorts(text: string): number[] {
    const ports: number[] = [];
    for (const line of text.split("\n")) {
        const match = /^\s*EXPOSE\s+([\d\s]+)/i.exec(line);
        if (match?.[1]) {
            for (const token of match[1].trim().split(/\s+/)) {
                const port = Number(token);
                if (Number.isInteger(port) && port > 0 && port <= 65535) ports.push(port);
            }
        }
    }
    return [...new Set(ports)];
}

/** Rank a compose file path: prod > base > dev > override. */
function rankComposeFile(path: string): { score: number; kind: "prod" | "dev" | "base" | "override" } {
    const lower = path.toLowerCase();
    if (lower.includes("prod")) return { score: 0, kind: "prod" };
    if (lower.includes("override")) return { score: 3, kind: "override" };
    if (lower.includes("dev")) return { score: 2, kind: "dev" };
    return { score: 1, kind: "base" };
}

/** Find all compose files anywhere in the repo, best (prod) first. */
function findComposeFiles(allFiles: string[]): { path: string; kind: "prod" | "dev" | "base" | "override" }[] {
    const candidates: { path: string; kind: "prod" | "dev" | "base" | "override" }[] = [];
    for (const path of allFiles) {
        const base = path.split("/").pop()?.toLowerCase() ?? "";
        const isCompose =
            base === "docker-compose.yml" || base === "docker-compose.yaml" ||
            base === "compose.yml" || base === "compose.yaml" ||
            /^docker-compose\..*\.ya?ml$/.test(base) ||
            /^compose\..*\.ya?ml$/.test(base);
        if (!isCompose) continue;
        const { kind } = rankComposeFile(path);
        candidates.push({ path, kind });
    }
    // Rank: prod first, then base, then dev, then override. Root-level wins ties.
    candidates.sort((a, b) => {
        const ra = rankComposeFile(a.path);
        const rb = rankComposeFile(b.path);
        if (ra.score !== rb.score) return ra.score - rb.score;
        // Prefer the one at repo root over nested.
        const depthA = a.path.split("/").length;
        const depthB = b.path.split("/").length;
        if (depthA !== depthB) return depthA - depthB;
        return a.path.localeCompare(b.path);
    });
    return candidates;
}

/** Find the best Dockerfile: near the compose file, else any Dockerfile. */
function findDockerfile(allFiles: string[], composePath?: string): string | undefined {
    const dockerfiles = allFiles.filter((p) => {
        const base = p.split("/").pop()?.toLowerCase() ?? "";
        return base === "dockerfile" || /^dockerfile(\..+)?$/.test(base);
    });
    if (dockerfiles.length === 0) return undefined;
    // Prefer a Dockerfile in the same dir as the compose file.
    if (composePath) {
        const composeDir = composePath.includes("/") ? composePath.slice(0, composePath.lastIndexOf("/")) : "";
        const near = dockerfiles.find((p) => {
            const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
            return dir === composeDir;
        });
        if (near) return near;
    }
    // Prefer a root Dockerfile (or the shortest path).
    dockerfiles.sort((a, b) => {
        const depthA = a.split("/").length;
        const depthB = b.split("/").length;
        if (depthA !== depthB) return depthA - depthB;
        return a.localeCompare(b);
    });
    return dockerfiles[0];
}

/** Build recommendations from files found in the repo (CI, configs, etc.). */
function buildRecommendations(allFiles: string[], rootFiles: Set<string>): { kind: "ci" | "dockerfile" | "env-example" | "kubernetes" | "terraform" | "makefile" | "package-manager" | "ignore-file"; path: string; label?: string }[] {
    const recommendations: { kind: "ci" | "dockerfile" | "env-example" | "kubernetes" | "terraform" | "makefile" | "package-manager" | "ignore-file"; path: string; label?: string }[] = [];
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

/** Extract the base image from the first FROM line of a Dockerfile. */
function extractDockerfileBase(text: string): string | undefined {
    const line = text.split("\n").find((l) => l.trim().startsWith("FROM "));
    const match = line?.match(/^FROM\s+([^\s]+)/i);
    return match?.[1];
}

/** Extract host ports from a docker-compose services.ports block. */
function extractComposePorts(text: string): number[] {
    const ports: number[] = [];
    let inPorts = false;
    for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (line.startsWith("ports:")) {
            inPorts = true;
            continue;
        }
        if (inPorts) {
            if (line.startsWith("- ") && line.length > 2) {
                const match = /(\d{2,5})/.exec(line);
                const port = match ? Number(match[1]) : NaN;
                if (Number.isInteger(port) && port > 0 && port <= 65535) ports.push(port);
                continue;
            }
            // A new top-level or service key ends the ports block.
            if (!line.startsWith("- ") && /^[a-zA-Z0-9_./-]+:/.test(line)) inPorts = false;
        }
    }
    return [...new Set(ports)];
}

/** Best-effort rootPath (the first service's build context dir) from a compose file. */
function extractComposeRootPath(text: string): string | undefined {
    const match = /context:\s*([^\s#]+)/.exec(text);
    const value = match?.[1];
    return value && value !== "." ? value : undefined;
}

/** Python start command from pyproject.toml (uvicorn/gunicorn/web frameworks). */
function extractPythonStart(text: string): string | undefined {
    if (/uvicorn/i.test(text)) {
        const app = /(?:uvicorn\s+)?([a-zA-Z0-9_.]+:app)/i.exec(text);
        return app?.[1] ? `uvicorn ${app[1]}` : undefined;
    }
    if (/gunicorn/i.test(text)) return undefined; // needs app module — leave unset
    if (/\[project\.scripts\]/i.test(text)) {
        const line = text.split("\n").find((l) => /^\s*[a-z0-9_-]+\s*=\s*"/i.test(l));
        return line?.split("=")[0]?.trim();
    }
    return undefined;
}

/** Python start command from requirements.txt (fastapi/flask/django). */
function extractPythonStartFromRequirements(text: string): string | undefined {
    if (/uvicorn/i.test(text)) return "uvicorn main:app --host 0.0.0.0";
    if (/gunicorn/i.test(text)) return "gunicorn app:app --bind 0.0.0.0:8000";
    if (/flask/i.test(text)) return "python app.py";
    if (/django/i.test(text)) return "python manage.py runserver 0.0.0.0:8000";
    return undefined;
}
