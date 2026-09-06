/**
 * GitHub App Configuration Contracts
 *
 * CRUD for GitHub App configurations stored in the database.
 * OAuth flow, repo listing, and runner detection.
 */
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import type { InferInputSchema } from "@repo/orpc-utils";
import z from "zod/v4";
import type { WebhookEvent, WebhookEventMap } from "@octokit/webhooks-types";
import { isRecord } from "@repo/type-guards";

// ─── Schemas ──────────────────────────────────────────────────────────────

export const githubAppConfigSchema = z.object({
    id: z.string(),
    name: z.string().min(1, "Name is required"),
    appId: z.string().min(1, "GitHub App ID is required"),
    clientId: z.string().min(1, "Client ID is required"),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const createGithubAppInputSchema = z.object({
    name: z.string().min(1, "Name is required"),
    appId: z.string().min(1, "GitHub App ID is required"),
    clientId: z.string().min(1, "Client ID is required"),
    clientSecret: z.string().min(1, "Client Secret is required"),
    privateKey: z.string().min(1, "Private Key is required"),
    webhookSecret: z.string().min(1, "Webhook Secret is required"),
});

export const updateGithubAppInputSchema = z.object({
    name: z.string().min(1).optional(),
    clientId: z.string().min(1).optional(),
    clientSecret: z.string().min(1).optional(),
    privateKey: z.string().min(1).optional(),
    webhookSecret: z.string().min(1).optional(),
});

const githubAppListOutputSchema = z.object({
    apps: z.array(githubAppConfigSchema),
    total: z.number(),
});

// ─── OAuth schemas ────────────────────────────────────────────────────────

const oauthInitOutputSchema = z.object({
    url: z.string(),
    state: z.string(),
});

// ─── Self-check schema ─────────────────────────────────────────────

const selfCheckOutputSchema = z.object({
    reachable: z.boolean(),
    publicUrl: z.string().nullable(),
    localUrl: z.string(),
    error: z.string().optional(),
    latencyMs: z.number().optional(),
});

// ─── Manifest flow schemas ────────────────────────────────────────────

/**
 * Manifest init input — the authenticated web app passes the URL where the
 * browser should land after GitHub creates the app. That page (on the web
 * app origin) holds the session cookie and POSTs the callback to the API.
 * The API never receives the browser redirect (GitHub → web app → API).
 */
const manifestInitInputSchema = z.object({
    /** Absolute URL of the web-app callback page (validated http/https). */
    redirectUrl: z.string().url().optional(),
});

const manifestInitOutputSchema = z.object({
    url: z.string(),
    /** Target for the manifest POST (GitHub's /settings/apps/new). */
    target: z.string(),
    /** JSON-encoded GitHub App manifest that pre-fills the create-app form. */
    manifest: z.string(),
    reachable: z.boolean(),
    publicUrl: z.string().nullable(),
    appName: z.string(),
});

const manifestCallbackInputSchema = z.object({
    code: z.string().min(1),
    state: z.string().min(1),
});

const manifestCallbackOutputSchema = z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    appId: z.string(),
    clientId: z.string(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    htmlUrl: z.string().optional(),
});

const oauthCallbackInputSchema = z.object({
    code: z.string().min(1),
    state: z.string().min(1),
    appId: z.string().min(1),
});

const oauthCallbackOutputSchema = z.object({
    success: z.boolean(),
    installationId: z.string().optional(),
});

/**
 * Installation callback — after the user installs the GitHub App (choosing
 * all repos or a subset), GitHub redirects to the manifest's `setup_url`
 * with an `installation_id` query param. The web install-callback page
 * POSTs it here (with the appName embedded in the setup URL) so the app
 * row's installation id is persisted, making repos immediately listable.
 */
const installCallbackInputSchema = z.object({
    appName: z.string().min(1, "GitHub App name is required"),
    installationId: z.string().min(1, "Installation id is required"),
});

const installCallbackOutputSchema = z.object({
    success: z.boolean(),
    appName: z.string(),
    installationId: z.string(),
});

// ─── Repo schemas ─────────────────────────────────────────────────────────

export const gitHubRepoListRepoSchema = z.object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    description: z.string().nullable(),
    html_url: z.string(),
    default_branch: z.string(),
    language: z.string().nullable(),
    private: z.boolean(),
    updated_at: z.string(),
});

export const gitHubBranchSchema = z.object({
    name: z.string(),
    sha: z.string(),
    protected: z.boolean(),
});

const branchListOutputSchema = z.object({
    owner: z.string(),
    repo: z.string(),
    branches: z.array(gitHubBranchSchema),
});

const repoListOutputSchema = z.object({
    repos: z.array(gitHubRepoListRepoSchema),
    /** Runtime metadata about the app/installation used for this listing. */
    _meta: z.object({
        installed: z.boolean(),
        appId: z.string().nullable().optional(),
        /** The app slug/name — used to build the GitHub install URL. */
        appName: z.string().nullable().optional(),
        message: z.string().optional(),
    }).optional(),
});

// ─── Runner detection schema ──────────────────────────────────────────────

/** Best-effort hints extracted from the repository contents. */
export const runnerDetectionHintsSchema = z.object({
    language: z.string().optional(),
    framework: z.string().optional(),
    packageManager: z.string().optional(),
    nodeVersion: z.string().optional(),
    startCommand: z.string().optional(),
    buildCommand: z.string().optional(),
    ports: z.array(z.number().int().positive()).optional(),
    rootPath: z.string().optional(),
    buildContext: z.string().optional(),
    dockerfilePath: z.string().optional(),
    composeFile: z.string().optional(),
    /** All compose files found anywhere in the repo (best candidate first). */
    composeCandidates: z.array(z.object({
        path: z.string(),
        kind: z.enum(["prod", "dev", "base", "override"]),
        serviceCount: z.number().int().nonnegative().optional(),
    })).optional(),
    /** Other useful files / configurations worth recommending. */
    recommendations: z.array(z.object({
        kind: z.enum(["ci", "dockerfile", "env-example", "kubernetes", "terraform", "makefile", "package-manager", "ignore-file"]),
        path: z.string(),
        label: z.string().optional(),
    })).optional(),
    outputDir: z.string().optional(),
    indexFile: z.string().optional(),
    /** Sub-services detected inside a compose (orchestrator) manifest. */
    composeServices: z.array(z.object({
        name: z.string(),
        image: z.string(),
        build: z.object({
            context: z.string().optional(),
            dockerfile: z.string().optional(),
            args: z.record(z.string(), z.string()).optional(),
        }).optional(),
        ports: z.array(z.number().int().positive()).optional(),
        dependsOn: z.array(z.string()).optional(),
        dependsOnCondition: z.string().optional(),
        environment: z.record(z.string(), z.string()).optional(),
        replicas: z.number().int().positive().optional(),
        command: z.string().optional(),
        entrypoint: z.string().optional(),
        volumes: z.array(z.string()).optional(),
        networks: z.array(z.string()).optional(),
        labels: z.record(z.string(), z.string()).optional(),
        secrets: z.array(z.string()).optional(),
        restart: z.string().optional(),
        healthCheck: z.object({
            test: z.array(z.string()).optional(),
            interval: z.number().optional(),
            timeout: z.number().optional(),
            retries: z.number().optional(),
            startPeriod: z.number().optional(),
        }).optional(),
        resources: z.object({
            cpus: z.number().optional(),
            memory: z.string().optional(),
        }).optional(),
    })).optional(),
});

const detectedRunnerSchema = z.object({
    builderId: z.string(),
    name: z.string(),
    description: z.string(),
    confidence: z.number().min(0).max(1),
    config: runnerDetectionHintsSchema.optional(),
});

const detectRunnerOutputSchema = z.object({
    detected: z.array(detectedRunnerSchema),
    defaultBuilder: z.string().nullable(),
});

const githubAppOps = standard.zod(githubAppConfigSchema, "githubApp");
const repoOps = standard.zod(gitHubRepoListRepoSchema, "gitHubRepo");

// ─── Contracts ────────────────────────────────────────────────────────────

export const githubAppListContract = githubAppOps
    .list()
    .path("/github/apps")
    .input(z.object({}))
    .output(githubAppListOutputSchema)
    .errors((e) => [
        ...standardDomainErrorContracts(e),
    ])
    .build();

export const githubAppCreateContract = githubAppOps
    .create()
    .path("/github/apps")
    .input((b) => b.body(createGithubAppInputSchema))
    .output(githubAppConfigSchema)
    .errors((e) => [
        // 409 duplicate app name; 400 invalid OAuth config.
        ...standardDomainErrorContracts(e),
    ])
    .build();

export const githubAppUpdateContract = githubAppOps
    .update()
    .input((b) =>
        b
            .params((p) => p`/github/apps/${p("id", z.string())}`)
            .body(updateGithubAppInputSchema),
    )
    .output(githubAppConfigSchema)
    .errors((e) => [
        // 404 for unknown app id.
        ...standardDomainErrorContracts(e),
    ])
    .build();

export const githubAppDeleteContract = githubAppOps
    .delete()
    .input((b) => b.params((p) => p`/github/apps/${p("id", z.string())}`))
    .output(z.object({ success: z.boolean() }))
    .errors((e) => [
        // 404 for unknown app id.
        ...standardDomainErrorContracts(e),
    ])
    .build();

// ─── PAT (Personal Access Token) schema ──────────────────────────────

export const createFromPatInputSchema = z.object({
    name: z.string().min(1, "Name is required"),
    pat: z.string().min(1, "Personal Access Token is required"),
});

// ─── OAuth / Manifest Contracts ───────────────────────────────────────────

const selfCheckOps = standard.zod(selfCheckOutputSchema, "selfCheck");
const oauthInitOps = standard.zod(oauthInitOutputSchema, "oauthInit");
const oauthCallbackOps = standard.zod(oauthCallbackOutputSchema, "oauthCallback");

export const githubAppSelfCheckContract = selfCheckOps
    .list()
    .path("/github/apps/self-check")
    .input(z.object({}))
    .output(selfCheckOutputSchema)
    .errors((e) => [
        ...standardDomainErrorContracts(e),
    ])
    .build();

export const githubAppManifestInitContract = oauthInitOps
    .create()
    .path("/github/manifest/init")
    .input((b) => b.body(manifestInitInputSchema))
    .output(manifestInitOutputSchema)
    .errors((e) => [
        // 400 when no reachable public access point is configured.
        ...standardDomainErrorContracts(e),
    ])
    .build();

/**
 * GitHub App manifest CALLBACK — the WEB APP calls this after the browser
 * lands on the web callback page (which holds the session cookie). It is a
 * POST mutation called with the authenticated session; the API never
 * receives GitHub's browser redirect directly.
 */
export const githubAppManifestCallbackContract = oauthCallbackOps
    .create()
    .path("/github/manifest/callback")
    .input((b) => b.body(manifestCallbackInputSchema))
    .output(manifestCallbackOutputSchema)
    .errors((e) => [
        // 400 when the app row cannot be persisted from the manifest.
        ...standardDomainErrorContracts(e),
    ])
    .build();

export const githubAppCreateFromPatContract = githubAppOps
    .create()
    .path("/github/apps/pat")
    .input((b) => b.body(createFromPatInputSchema))
    .output(githubAppConfigSchema)
    .errors((e) => [
        ...standardDomainErrorContracts(e),
    ])
    .build();

/** Installation callback — persists the installation id after the user installs the app. */
export const githubInstallCallbackContract = oauthCallbackOps
    .create()
    .path("/github/install/callback")
    .input((b) => b.body(installCallbackInputSchema))
    .output(installCallbackOutputSchema)
    .errors((e) => [
        // 400 invalid installation id; 404 unknown app name.
        ...standardDomainErrorContracts(e),
    ])
    .build();

export const githubAppOAuthInitContract = oauthInitOps
    .create()
    .input((b) =>
        b.params((p) => p`/github/apps/${p("appId", z.string())}/oauth/init`),
    )
    .output(oauthInitOutputSchema)
    .errors((e) => [
        // 404 unknown app; 400 missing/unreachable public access point.
        ...standardDomainErrorContracts(e),
    ])
    .build();

export const githubAppOAuthCallbackContract = oauthCallbackOps
    .create()
    .path("/github/oauth/callback")
    .input((b) => b.body(oauthCallbackInputSchema))
    .output(oauthCallbackOutputSchema)
    .errors((e) => [
        // 404 unknown app; 400 code exchange returned no token.
        ...standardDomainErrorContracts(e),
    ])
    .build();

// ─── Repo & Detection Contracts ───────────────────────────────────────────

/**
 * List repositories accessible to a GitHub App. When `providerAppId` is
 * passed, only that app's repos are returned. When omitted, the first
 * active app with an installation is used (backwards-compatible).
 */
const listReposQuerySchema = z.object({
    providerAppId: z.string().optional(),
});

export const githubListReposContract = repoOps
    .list()
    .path("/github/repos")
    .input((b) => b.query(listReposQuerySchema))
    .output(repoListOutputSchema)
    .build();

/** Query for the detectRunner endpoint. */
const detectRunnerQuerySchema = z.object({
    providerAppId: z.string().optional(),
    /** Re-detect sub-services for a SPECIFIC compose file (instead of the top-ranked one). */
    composeFile: z.string().optional(),
});

export const githubDetectRunnerContract = standard
    .zod(detectRunnerOutputSchema, "runnerDetection")
    .list()
    .input((b) =>
        b
            .params((p) => p`/github/repos/${p("owner", z.string())}/${p("repo", z.string())}/detect`)
            .query(detectRunnerQuerySchema),
    )
    .output(detectRunnerOutputSchema)
    .build();

/**
 * List branches of a repository for a GitHub App's installation.
 * `providerAppId` scopes which app's installation is used.
 */
const listBranchesQuerySchema = z.object({
    providerAppId: z.string().optional(),
});

export const githubListBranchesContract = repoOps
    .list()
    .input((b) =>
        b
            .params((p) => p`/github/repos/${p("owner", z.string())}/${p("repo", z.string())}/branches`)
            .query(listBranchesQuerySchema),
    )
    .output(branchListOutputSchema)
    .build();

// ─── Webhook Contract ─────────────────────────────────────────────────────

/**
 * GitHub webhook delivery. GitHub POSTs raw payloads to `/webhooks/github`
 * with `X-GitHub-Event`, `X-GitHub-Delivery` and `X-Hub-Signature-256`
 * headers. The route is guarded by the `githubWebhookAuth` ORPC middleware
 * (signature verification + idempotency) — see
 * `apps/api/src/modules/providers/middleware/github-webhook-auth.middleware.ts`.
 *
 * The input uses the DETAILED input structure: `{ body, headers }`.
 * The body is a passthrough schema: GitHub payloads are arbitrary JSON
 * and we intentionally do NOT parse/validate them here (the handler narrows
 * per-event). `z.custom<WebhookEvent>()` keeps the runtime passthrough while
 * making the schema's inferred type the official `@octokit/webhooks-types`
 * `WebhookEvent` union — so `z.infer` and the ORPC handler's `input.body`
 * are typed with the SDK's payload types, not `unknown`/`Record<string, unknown>`.
 *
 * The headers schema types the GitHub delivery headers that the ORPC codec
 * decodes into `input.headers` (the raw request headers object), so the
 * middleware can read everything from `input` instead of reaching into the
 * request object.
 */
export const githubWebhookPayloadSchema = z.custom<WebhookEvent>();

/** GitHub delivery headers — decoded by the ORPC codec into `input.headers`. */
export const githubWebhookHeadersSchema = z.object({
    "x-github-event": z.string().optional(),
    "x-github-delivery": z.string().optional(),
    "x-hub-signature-256": z.string().optional(),
});

// ─── Webhook type guards ───────────────────────────────────────────────────

/**
 * Runtime type guard — narrows a `WebhookEvent` to the SDK `pull_request`
 * payload. Checks the event header AND the fields the handlers consume
 * (`pull_request.number`, `head.ref`, `head.sha`) so the predicate is a real
 * runtime guard, not a blind cast.
 */
export function isPullRequestWebhook(
    eventType: string,
    payload: WebhookEvent,
): payload is WebhookEventMap["pull_request"] {
    return eventType === "pull_request"
        && isRecord(payload)
        && isRecord(payload.pull_request)
        && typeof payload.pull_request.number === "number"
        && isRecord(payload.pull_request.head)
        && typeof payload.pull_request.head.ref === "string"
        && typeof payload.pull_request.head.sha === "string";
}

/**
 * Runtime type guard — narrows a `WebhookEvent` to the SDK installation
 * payload. A full `Installation` (with a numeric `app_id`) only appears on
 * installation events — other events carry only `InstallationLite`
 * ({ id, node_id }) — so `app_id` is the discriminator.
 */
export function isInstallationWebhook(
    eventType: string,
    payload: WebhookEvent,
): payload is WebhookEventMap["installation"] | WebhookEventMap["installation_repositories"] {
    return (eventType === "installation" || eventType === "installation_repositories")
        && isRecord(payload)
        && isRecord(payload.installation)
        && typeof payload.installation.id === "number"
        && typeof payload.installation.app_id === "number";
}

const githubWebhookOutputSchema = z.object({
    received: z.literal(true),
    deliveryId: z.string(),
    action: z.string().optional(),
    reason: z.string().optional(),
});

const githubWebhookOps = standard.zod(githubWebhookOutputSchema, "githubWebhook");

export const githubWebhookContract = githubWebhookOps
    .create()
    .path("/webhooks/github")
    .input((b) => b
        .body(githubWebhookPayloadSchema)
        .headers(githubWebhookHeadersSchema),
    )
    .output(githubWebhookOutputSchema)
    .errors((e) => [
        // 400 malformed webhook payload.
        ...standardDomainErrorContracts(e),
    ])
    .build();
    
type GithubWebhookInput = z.infer<InferInputSchema<typeof githubWebhookContract>>;
export type { GithubWebhookInput };

// ─── Aggregated Contract ─────────────────────────────────────────────────

export const githubAppContract = {
    list: githubAppListContract,
    create: githubAppCreateContract,
    update: githubAppUpdateContract,
    delete: githubAppDeleteContract,
    oauthInit: githubAppOAuthInitContract,
    oauthCallback: githubAppOAuthCallbackContract,
    listRepos: githubListReposContract,
    listBranches: githubListBranchesContract,
    detectRunner: githubDetectRunnerContract,
    installCallback: githubInstallCallbackContract,
    selfCheck: githubAppSelfCheckContract,
    manifestInit: githubAppManifestInitContract,
    manifestCallback: githubAppManifestCallbackContract,
    createFromPat: githubAppCreateFromPatContract,
    webhook: githubWebhookContract,
};

export type GitHubAppContract = typeof githubAppContract;
export type RunnerDetectionHints = z.infer<typeof runnerDetectionHintsSchema>;

// ─── GitHub SDK webhook payload types ─────────────────────────────────────
//
// Re-exported so API handlers can type their webhook dispatch with the
// official `@octokit/webhooks-types` payloads (the same types the
// `githubWebhookPayloadSchema` resolves to) instead of loose `unknown`.
export type {
    WebhookEvent,
    WebhookEventMap,
    WebhookEventName,
    PullRequestEvent,
    InstallationEvent,
    InstallationRepositoriesEvent,
    PushEvent,
    CreateEvent,
    DeleteEvent,
} from "@octokit/webhooks-types";
