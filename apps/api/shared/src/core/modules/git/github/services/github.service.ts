import { Context, Effect } from 'effect'
import { App } from '@octokit/app'
import { Octokit } from '@octokit/rest'
import { Webhooks } from '@octokit/webhooks'
import z from 'zod/v4'

import { domainError } from "@deployer/effect-core";

/**
 * Minimal `@octokit/core` client returned by `App.getInstallationOctokit()` —
 * it has no `rest.*` namespaces; callers must use `octokit.request()` with the
 * raw endpoint. Derived from the App class so no direct `@octokit/core`
 * dependency is required.
 */
type InstallationOctokit = Awaited<ReturnType<InstanceType<typeof App>['getInstallationOctokit']>>

type GitHubAppConfig = {
  appId: string
  privateKey: string
  clientId?: string
  clientSecret?: string
  webhookSecret?: string
}

/**
 * Repository data structure from GitHub API
 */
type GitHubRepository = {
  id: number
  name: string
  full_name: string
  private: boolean
  description: string | null
  html_url: string
  default_branch: string
  language: string | null
  stargazers_count: number
  forks_count: number
}

/**
 * Zod schema for the GitHub App Manifest conversion response
 * (POST /app-manifests/{code}/conversions). The response crosses a trust
 * boundary — this schema makes the field nullability explicit so the
 * downstream types are truthful.
 */
const githubManifestResponseSchema = z.object({
  id: z.number(),
  slug: z.string().optional().default(''),
  name: z.string().optional().default(''),
  client_id: z.string().optional().default(''),
  client_secret: z.string().optional().default(''),
  pem: z.string().optional().default(''),
  webhook_secret: z.string().optional().default(''),
  html_url: z.string().optional().default(''),
})

// ─── Runner-detection response schemas (octokit crosses a trust boundary) ──

/** Entry of `GET /repos/{owner}/{repo}/contents/{path}` (root listing). */
const githubContentEntrySchema = z.object({ name: z.string().optional() }).loose()

/** Entry of `GET /repos/{owner}/{repo}/git/trees/{tree_sha}`. */
const githubTreeEntrySchema = z
  .object({
    path: z.string().optional(),
    type: z.string().optional(),
  })
  .loose()

/** Body of `GET /repos/{owner}/{repo}/contents/{path}` for a single file. */
const githubFileContentSchema = z.object({ content: z.string().nullish() }).loose()

/**
 * Octokit types entity ids as `number | bigint` (union across response kinds),
 * but the wire payload is always a JSON number. Parse — never cast.
 */
const githubNumericIdSchema = z.number()

/**
 * Installation account information
 */
type GitHubInstallationAccount = {
  login: string
  type: string
  avatar_url: string
}

/**
 * Installation data structure
 */
type GitHubInstallation = {
  id: number
  account: GitHubInstallationAccount
  repository_selection: string
  permissions: Record<string, string>
  events: string[]
  created_at: string
  updated_at: string
}

/**
 * Commit author information
 */
type GitHubCommitAuthor = {
  name: string
  email: string
  date: string
}

/**
 * Commit data structure
 */
type GitHubCommitInfo = {
  sha: string
  message: string
  author: GitHubCommitAuthor
  url: string
}


// ── Tagged errors ─────────────────────────────────────────────────────────────────────────────────────────────────

/** No GitHub App is registered for the organization (the in-memory registry is lost on restart; callers re-register). */
export class GitHubAppNotRegistered extends domainError("GitHubAppNotRegistered", "not_found")<{ readonly organizationLogin: string }>() {
  override publicMessage() { return `GitHub App not registered for organization: ${this.organizationLogin}`; }
}

/** The GitHub App credentials cannot build an App (a malformed private key, ...). */
export class GitHubAppConfigInvalid extends domainError("GitHubAppConfigInvalid", "validation")<{ readonly organizationLogin: string }>() {
  override publicMessage() { return `Invalid GitHub App credentials for ${this.organizationLogin}`; }
}

/** A GitHub API call failed or answered something unusable; the cause (which may name tokens) stays server-side. */
export class GitHubApiFailure extends domainError("GitHubApiFailure", "dependency_missing")<{ readonly operation: string }>() {
  override publicMessage() { return `GitHub ${this.operation} failed`; }
}

type GitHubFailure = GitHubAppNotRegistered | GitHubApiFailure;
type Ported<A> = Effect.Effect<A, GitHubFailure>;

export type GitHubServiceShape = {
  // ── the in-memory App registry ───────────────────────────────────────────────────────────────────────────────────
  /** Register (or replace) an organization's GitHub App from DB-loaded credentials. */
  readonly registerInstallation: (organizationLogin: string, config: GitHubAppConfig) => Effect.Effect<void, GitHubAppConfigInvalid>;
  readonly getAppForOrganization: (organizationLogin: string) => Effect.Effect<App, GitHubAppNotRegistered>;
  readonly hasAppForOrganization: (organizationLogin: string) => boolean;
  readonly unregisterInstallation: (organizationLogin: string) => void;
  readonly getRegisteredOrganizations: () => string[];

  // ── credentials / clients ────────────────────────────────────────────────────────────────────────────────────────
  /** Verify a webhook signature with the organization's secret; any error is `false`. */
  readonly verifyWebhookSignature: (payload: string, signature: string, webhookSecret: string) => Effect.Effect<boolean>;
  /** A minimal `@octokit/core` client for an installation: use `octokit.request()` with the raw endpoint. */
  readonly getInstallationOctokit: (organizationLogin: string, installationId: number) => Ported<InstallationOctokit>;
  readonly getOctokitWithToken: (token: string) => Octokit;
  readonly getPublicOctokit: () => Octokit;
  readonly createWebhooks: (webhookSecret: string) => Webhooks;
  readonly exchangeCodeForToken: (
    organizationLogin: string,
    code: string,
  ) => Ported<{ access_token: string; token_type: string; scope: string }>;
  /** Exchange a GitHub App Manifest code for the app's credentials (POST /app-manifests/{code}/conversions). */
  readonly createFromManifestCode: (code: string) => Effect.Effect<
    { id: number; slug: string; name: string; client_id: string; client_secret: string; pem: string; webhook_secret: string; html_url: string },
    GitHubApiFailure
  >;
  readonly getInstallationAccessToken: (organizationLogin: string, installationId: number) => Ported<string>;

  // ── reads ────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The installations of a registered App (GET /app/installations): used to rediscover an installation id. */
  readonly listInstallations: (organizationLogin: string) => Ported<{ id: number; accountLogin: string; accountType: string }[]>;
  readonly listInstallationRepositories: (organizationLogin: string, installationId: number) => Ported<GitHubRepository[]>;
  readonly listRepositoryBranches: (
    organizationLogin: string,
    installationId: number,
    owner: string,
    repo: string,
  ) => Ported<{ name: string; sha: string; protected: boolean }[]>;
  readonly getRepository: (owner: string, repo: string, organizationLogin?: string, installationId?: number) => Ported<GitHubRepository>;
  readonly getInstallation: (organizationLogin: string, installationId: number) => Ported<GitHubInstallation>;
  readonly getCommit: (owner: string, repo: string, sha: string, organizationLogin?: string, installationId?: number) => Ported<GitHubCommitInfo>;
  /** Root listing of a repository, for runner detection. A malformed answer is an empty list. */
  readonly listRepositoryRoot: (organizationLogin: string, installationId: number, owner: string, repo: string) => Ported<string[]>;
  /** Every file path via the git trees API; falls back to the root listing when the tree API fails. */
  readonly listRepositoryFiles: (
    organizationLogin: string,
    installationId: number,
    owner: string,
    repo: string,
    branch?: string,
  ) => Ported<string[]>;
  /** A file's decoded content; `null` when it is missing, a directory or a submodule. */
  readonly getRepositoryFileContent: (
    organizationLogin: string,
    installationId: number,
    owner: string,
    repo: string,
    path: string,
  ) => Ported<string | null>;

  // ── writes ───────────────────────────────────────────────────────────────────────────────────────────────────────
  readonly createDeploymentStatus: (
    owner: string,
    repo: string,
    deploymentId: number,
    state: "error" | "failure" | "inactive" | "in_progress" | "queued" | "pending" | "success",
    organizationLogin: string,
    installationId: number,
    options?: { description?: string; environment_url?: string; log_url?: string },
  ) => Ported<void>;
};

function createApp(config: GitHubAppConfig): App {
  return new App({
    appId: config.appId,
    privateKey: config.privateKey.replace(/\\n/g, "\n"), // Handle escaped newlines
    oauth: config.clientId && config.clientSecret ? { clientId: config.clientId, clientSecret: config.clientSecret } : undefined,
    webhooks: config.webhookSecret ? { secret: config.webhookSecret } : undefined,
  });
}

const toRepository = (data: {
  id: number | bigint;
  name: string;
  full_name: string;
  private: boolean;
  description?: string | null;
  html_url: string;
  default_branch: string;
  language?: string | null;
  stargazers_count: number;
  forks_count: number;
}): GitHubRepository => ({
  id: githubNumericIdSchema.parse(data.id),
  name: data.name,
  full_name: data.full_name,
  private: data.private,
  description: data.description ?? null,
  html_url: data.html_url,
  default_branch: data.default_branch,
  language: data.language ?? null,
  stargazers_count: data.stargazers_count,
  forks_count: data.forks_count,
});

/**
 * The GitHub client. Credentials (appId, privateKey, webhookSecret, ...) are stored per organization in the database; the
 * App instances are cached here in memory and re-registered by callers after a restart. The cache is the service's state,
 * so it is built once.
 */
export function makeGitHubService(): GitHubServiceShape {
  const apps = new Map<string, App>(); // cached by organization login
  const publicOctokit = new Octokit();

  /** One GitHub call: any rejection is a `GitHubApiFailure` for `operation`. */
  const github = <A>(operation: string, run: () => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: (cause) => new GitHubApiFailure({ operation, cause }) });

  const getAppForOrganization: GitHubServiceShape["getAppForOrganization"] = (organizationLogin) => {
    const app = apps.get(organizationLogin);
    return app ? Effect.succeed(app) : Effect.fail(new GitHubAppNotRegistered({ organizationLogin }));
  };

  const getInstallationOctokit: GitHubServiceShape["getInstallationOctokit"] = (organizationLogin, installationId) =>
    getAppForOrganization(organizationLogin).pipe(
      Effect.flatMap((app) => github("installation authentication", () => app.getInstallationOctokit(installationId))),
    );

  /** The octokit to read with: the installation's when both ids are known, else the public one. */
  const octokitFor = (organizationLogin?: string, installationId?: number): Ported<Octokit | InstallationOctokit> =>
    installationId && organizationLogin ? getInstallationOctokit(organizationLogin, installationId) : Effect.succeed(publicOctokit);

  const listRepositoryRoot: GitHubServiceShape["listRepositoryRoot"] = (organizationLogin, installationId, owner, repo) =>
    Effect.gen(function* () {
      const octokit = yield* getInstallationOctokit(organizationLogin, installationId);
      const { data } = yield* github("repository root listing", () =>
        octokit.request("GET /repos/{owner}/{repo}/contents/{path}", { owner, repo, path: "" }),
      );
      const files = Array.isArray(data) ? data : [data];
      // Shape validation through Zod: never cast-based field access.
      const parsed = z.array(githubContentEntrySchema).safeParse(files);
      return parsed.success ? parsed.data.map((f) => f.name ?? "") : [];
    });

  /** Page through a listing 100 at a time until a short page. */
  const paged = <A>(operation: string, fetchPage: (page: number) => Promise<A[]>): Effect.Effect<A[], GitHubApiFailure> =>
    Effect.gen(function* () {
      const all: A[] = [];
      for (let page = 1; ; page++) {
        const items = yield* github(operation, () => fetchPage(page));
        all.push(...items);
        if (items.length < 100) return all;
      }
    });

  return {
    registerInstallation: (organizationLogin, config) =>
      Effect.try({
        try: () => {
          apps.set(organizationLogin, createApp(config));
        },
        catch: (cause) => new GitHubAppConfigInvalid({ organizationLogin, cause }),
      }).pipe(Effect.andThen(Effect.logInfo(`Registered GitHub App for organization: ${organizationLogin}`))),
    getAppForOrganization,
    hasAppForOrganization: (organizationLogin) => apps.has(organizationLogin),
    unregisterInstallation: (organizationLogin) => {
      apps.delete(organizationLogin);
    },
    getRegisteredOrganizations: () => Array.from(apps.keys()),

    verifyWebhookSignature: (payload, signature, webhookSecret) =>
      Effect.tryPromise({ try: () => new Webhooks({ secret: webhookSecret }).verify(payload, signature), catch: (cause) => cause }).pipe(
        Effect.catch((cause) => Effect.logError(`Webhook signature verification failed: ${String(cause)}`).pipe(Effect.as(false))),
      ),
    getInstallationOctokit,
    getOctokitWithToken: (token) => new Octokit({ auth: token }),
    getPublicOctokit: () => publicOctokit,
    createWebhooks: (webhookSecret) => new Webhooks({ secret: webhookSecret }),

    exchangeCodeForToken: (organizationLogin, code) =>
      Effect.gen(function* () {
        const app = yield* getAppForOrganization(organizationLogin);
        const { authentication } = yield* github("OAuth code exchange", () => app.oauth.createToken({ code }));
        const authData = authentication as { token: string; tokenType: string; scopes?: string[] };
        return { access_token: authData.token, token_type: authData.tokenType, scope: authData.scopes?.join(",") ?? "" };
      }),

    createFromManifestCode: (code) =>
      github("app manifest conversion", async () => {
        // Unauthenticated: the manifest code API is public.
        const { data } = await new Octokit().rest.apps.createFromManifest({ code });
        // GitHub's response crosses a trust boundary: Zod makes the nullability explicit.
        return githubManifestResponseSchema.parse(data);
      }),

    getInstallationAccessToken: (organizationLogin, installationId) =>
      Effect.gen(function* () {
        const octokit = yield* getInstallationOctokit(organizationLogin, installationId);
        const { data } = yield* github("installation access token", () =>
          octokit.request("POST /app/installations/{installation_id}/access_tokens", { installation_id: installationId }),
        );
        return data.token;
      }),

    listInstallations: (organizationLogin) =>
      Effect.gen(function* () {
        const app = yield* getAppForOrganization(organizationLogin);
        const result: { id: number; accountLogin: string; accountType: string }[] = [];
        yield* github("installation listing", () =>
          app.eachInstallation(({ installation }) => {
            const account = (installation as { account?: { login?: string; type?: string } }).account;
            result.push({ id: installation.id, accountLogin: account?.login ?? "", accountType: account?.type ?? "" });
          }),
        );
        return result;
      }),

    listInstallationRepositories: (organizationLogin, installationId) =>
      Effect.gen(function* () {
        const octokit = yield* getInstallationOctokit(organizationLogin, installationId);
        return yield* paged("installation repository listing", async (page) => {
          const { data } = await octokit.request("GET /installation/repositories", { per_page: 100, page });
          return data.repositories.map(toRepository);
        });
      }),

    listRepositoryBranches: (organizationLogin, installationId, owner, repo) =>
      Effect.gen(function* () {
        const octokit = yield* getInstallationOctokit(organizationLogin, installationId);
        return yield* paged("branch listing", async (page) => {
          const { data } = await octokit.request("GET /repos/{owner}/{repo}/branches", { owner, repo, per_page: 100, page });
          return data.map((b) => ({ name: b.name, sha: b.commit.sha, protected: b.protected }));
        });
      }),

    getRepository: (owner, repo, organizationLogin, installationId) =>
      Effect.gen(function* () {
        const octokit = yield* octokitFor(organizationLogin, installationId);
        const { data } = yield* github("repository lookup", () => octokit.request("GET /repos/{owner}/{repo}", { owner, repo }));
        return toRepository(data);
      }),

    getInstallation: (organizationLogin, installationId) =>
      Effect.gen(function* () {
        const octokit = yield* getInstallationOctokit(organizationLogin, installationId);
        const { data } = yield* github("installation lookup", () =>
          octokit.request("GET /app/installations/{installation_id}", { installation_id: installationId }),
        );
        // `account` can be a User or an Enterprise: handle both.
        const account = data.account;
        const accountLogin = account && "login" in account ? account.login : account && "slug" in account ? account.slug : "unknown";
        const accountType = account && "type" in account ? account.type : "Enterprise";
        return {
          id: data.id,
          account: { login: accountLogin, type: accountType, avatar_url: account?.avatar_url ?? "" },
          repository_selection: data.repository_selection,
          permissions: data.permissions,
          events: data.events,
          created_at: data.created_at,
          updated_at: data.updated_at,
        };
      }),

    getCommit: (owner, repo, sha, organizationLogin, installationId) =>
      Effect.gen(function* () {
        const octokit = yield* octokitFor(organizationLogin, installationId);
        const { data } = yield* github("commit lookup", () =>
          octokit.request("GET /repos/{owner}/{repo}/commits/{ref}", { owner, repo, ref: sha }),
        );
        return {
          sha: data.sha,
          message: data.commit.message,
          author: {
            name: data.commit.author?.name ?? "Unknown",
            email: data.commit.author?.email ?? "unknown@email.com",
            date: data.commit.author?.date ?? new Date().toISOString(),
          },
          url: data.html_url,
        };
      }),

    listRepositoryRoot,

    listRepositoryFiles: (organizationLogin, installationId, owner, repo, branch = "HEAD") =>
      Effect.gen(function* () {
        const octokit = yield* getInstallationOctokit(organizationLogin, installationId);
        return yield* github("repository tree", async () => {
          const { data } = await octokit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
            owner,
            repo,
            tree_sha: branch,
            recursive: "1",
          });
          const tree = z.array(githubTreeEntrySchema).safeParse(data.tree);
          if (!tree.success) return [];
          return tree.data.flatMap((entry) => (entry.type === "blob" && typeof entry.path === "string" ? [entry.path] : []));
        }).pipe(
          // Without the tree API (an empty repository) only the root can be listed.
          Effect.catch(() => listRepositoryRoot(organizationLogin, installationId, owner, repo)),
        );
      }),

    getRepositoryFileContent: (organizationLogin, installationId, owner, repo, path) =>
      Effect.gen(function* () {
        const octokit = yield* getInstallationOctokit(organizationLogin, installationId);
        return yield* github("file content", async () => {
          const { data } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", { owner, repo, path });
          if (Array.isArray(data)) return null;
          const parsed = githubFileContentSchema.safeParse(data);
          const content = parsed.success ? parsed.data.content : null;
          return content ? Buffer.from(content, "base64").toString("utf-8") : null;
        }).pipe(Effect.catch(() => Effect.succeed(null))); // missing file: nothing to inspect
      }),

    createDeploymentStatus: (owner, repo, deploymentId, state, organizationLogin, installationId, options) =>
      Effect.gen(function* () {
        const octokit = yield* getInstallationOctokit(organizationLogin, installationId);
        yield* github("deployment status", () =>
          octokit.request("POST /repos/{owner}/{repo}/deployments/{deployment_id}/statuses", {
            owner,
            repo,
            deployment_id: deploymentId,
            state,
            description: options?.description,
            environment_url: options?.environment_url,
            log_url: options?.log_url,
          }),
        );
      }),
  };
}

export class GitHubService extends Context.Service<GitHubService, GitHubServiceShape>()("shared/GitHubService") {}
