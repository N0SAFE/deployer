/**
 * WHICH SERVICE OWNS WHICH TABLE.
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
 * The services are split by domain, and the reason for that split is that each table
 * should have exactly ONE writer. Nothing enforced it: the schema is one package, so
 * any service can import any table, and the first cross-domain write would be
 * invisible in review — it looks exactly like a normal query.
 *
 * This registry makes ownership a declared fact with a test behind it
 * (`table-ownership.spec.ts`), so the answer to "may identity touch `deployments`?" is
 * a lookup rather than an opinion. Adding a table without claiming it fails the build;
 * claiming one twice fails the build.
 *
 * ── WHY THIS IS NOT ENFORCED BY PACKAGE BOUNDARIES ─────────────────────────
 * The obvious enforcement is one schema package per service, so `@deployer/svc-identity`
 * physically could not import `deployments`. It cannot work yet:
 *
 *  1. `packages/auth` sits BELOW the services and needs the auth tables. Moving those
 *     tables into `identity` would make the dependency `auth → identity → auth`.
 *
 * A registry plus a test gets the same guarantee — one writer per table, checked on
 * every commit — without that problem. (A second obstacle, the monolith reading every
 * table, went away when it was removed; the split is now only blocked by the auth cycle.)
 *
 * ── WHY MULTI-OWNER ENTRIES EXIST ───────────────────────────────────────────
 * A few tables genuinely have two legitimate readers and ONE writer, and pretending
 * otherwise would force a fake choice. They are listed with an explicit writer so the
 * distinction is recorded rather than implied: a reader may query them, and only the
 * named writer may mutate. This is the boundary that actually matters — the risk is not
 * a second SELECT, it is a second writer disagreeing about what the row means.
 */

/** The services that own tables, plus `platform` for app-wide bookkeeping. */
export type TableOwner =
	| "identity" // users, credentials, notifications, analytics
	| "project" // projects, services, domains, environments
	| "runtime" // deployments, docker, runners
	| "fleet" // cluster, nodes, providers, reachability
	| "health" // probes and their history
	| "platform"; // app-wide config, versions, schema bookkeeping

/**
 * Tables with more than one legitimate READER, but still a single writer.
 *
 * `writer` is the only service permitted to mutate; the others may read. Anything not
 * listed here has exactly one owner for all access.
 */
export type SharedTable = {
	readonly table: string;
	readonly writer: TableOwner;
	readonly readers: readonly TableOwner[];
	/** Why the sharing exists, so a future reader can judge whether it still should. */
	readonly reason: string;
}

/**
 * Infrastructure tables that EVERY service may read AND write, by design.
 *
 * `SHARED_TABLES` models a domain row with one authoritative decider, which is the
 * right model for `deployments` or `projects`. It does not fit the outbox: a
 * transactional outbox has to be written by whichever service commits the business
 * change, INSIDE that service's transaction, or it stops being transactional.
 *
 * Marking it `runtime` and adding readers would state something false — project and
 * runtime both insert into it — and would leak the runtime owner barrel into every
 * service for a row that has nothing to do with runtime's domain. These are therefore
 * modelled as what they are: platform infrastructure that any owner may use, with the
 * caveat that they carry no domain meaning of their own.
 */
export const INFRASTRUCTURE_TABLES: readonly { readonly table: string; readonly reason: string }[] = [
	{
		table: "local_event_outbox",
		reason:
			"a transactional outbox is written by the service making the business change, in the same transaction, and drained by whichever process runs the dispatcher. Restricting the writer to one service would force every other service's events through a network hop and lose atomicity with the row that caused them.",
	},
];

/**
 * Every table, and the service that owns it.
 *
 * Keys are the SQL table names (not the exported camelCase symbols) because that is
 * what appears in a query plan, a migration and an error message — the three places
 * somebody will actually be looking when they consult this.
 */
export const TABLE_OWNERSHIP: Readonly<Record<string, TableOwner>> = {
	// ── identity: who a person is, and reaching them ─────────────────────────
	user: "identity",
	session: "identity",
	account: "identity",
	verification: "identity",
	apikey: "identity",
	passkey: "identity",
	two_factor: "identity",
	device_code: "identity",
	platform_invite: "identity",
	user_vapid_keys: "identity",
	push_subscription: "identity",
	role_rules: "identity",
	analytics_reports: "identity",
	analytics_report_configs: "identity",

	// ── project: the aggregate an operator creates first ─────────────────────
	projects: "project",
	services: "project",
	service_dependencies: "project",
	project_collaborators: "project",
	project_domains: "project",
	service_domain_mappings: "project",
	project_scan_config: "project",
	environments: "project",
	environment_services: "project",
	service_environments: "project",
	environment_variables: "project",
	environment_templates: "project",
	environment_promotions: "project",
	environment_access_logs: "project",
	variable_templates: "project",
	config_files: "project",
	route_configs: "project",
	domain_configs: "project",
	service_config_references: "project",
	api_keys: "project",
	webhooks: "project",

	// ── runtime: what is running, and where it came from ────────────────────
	deployments: "runtime",
	deployment_logs: "runtime",
	deployment_streams: "runtime",
	deployment_rollbacks: "runtime",
	deployment_rules: "runtime",
	deployment_cache: "runtime",
	docker_image_security_scans: "runtime",
	docker_image_security_scan_history: "runtime",
	docker_image_security_lifecycle: "runtime",
	docker_runtime_activities: "runtime",
	image_project_membership: "runtime",

	// ── fleet: the machines this node knows about ───────────────────────────
	cluster_nodes: "fleet",
	cluster_node_metrics: "fleet",
	cluster_join_grants: "fleet",
	cluster_signing_keys: "fleet",
	cluster_server_allocations: "fleet",
	cluster_admission_requests: "fleet",
	cluster_migration_state: "fleet",
	resource_ownership_index: "fleet",
	node_network_config: "fleet",
	dns_providers: "fleet",
	provider_traefik_templates: "fleet",
	service_traefik_templates: "fleet",

	github_apps: "fleet",
	github_installations: "fleet",
	github_repositories: "fleet",
	github_repository_configs: "fleet",
	github_deployment_rules: "fleet",
	github_preview_deployments: "fleet",
	github_webhook_events: "fleet",
	gitlab_apps: "fleet",
	// ── health: probes and their history ────────────────────────────────────
	health_checks: "health",
	health_check_jobs: "health",
	service_health_configs: "health",

	// ── platform: app-wide facts and schema bookkeeping ─────────────────────
	app_config: "platform",
	app_instances: "platform",
	schema_version: "platform",
	seed_version: "platform",
	core_event_streams: "platform",
	core_event_logs: "platform",

	// ── runtime-local bookkeeping (SQLite side of the runtime) ──────────────
	local_runtime_processes: "runtime",
	local_build_cache: "runtime",
	local_queue_jobs: "runtime",
	local_event_outbox: "runtime",

	// ── traefik: the ingress configuration set ──────────────────────────────
	traefik_configs: "fleet",
	traefik_config_files: "fleet",
	traefik_static_configs: "fleet",
	traefik_static_files: "fleet",
	traefik_middleware: "fleet",
	traefik_middlewares: "fleet",
	traefik_plugins: "fleet",
	traefik_domain_routes: "fleet",
	traefik_service_configs: "fleet",
	traefik_service_targets: "fleet",
	traefik_ssl_certificates: "fleet",
	traefik_backups: "fleet",
};

/**
 * Tables read by more than one service, with the single service that may write them.
 *
 * Kept separate from `TABLE_OWNERSHIP` so the common case stays a one-word lookup and
 * the exceptions carry their justification.
 */
export const SHARED_TABLES: readonly SharedTable[] = [
	{
		table: "deployments",
		writer: "runtime",
		readers: ["project", "fleet", "identity"],
		reason:
			"a project's screen shows its latest deployment and a node's shows what it hosts, so both READ it — but only runtime decides what a deployment IS. Letting project write one would give two services an opinion about a deployment's status. identity reads them to aggregate analytics reports (counts by status over a date range); that is a read-only projection, and routing it through an event pipeline would mean reports cannot cover history that predates the pipeline.",
	},
	{
		table: "deployment_rollbacks",
		writer: "runtime",
		readers: ["identity"],
		reason:
			"identity counts rollbacks in an analytics report (rollback rate per project over a window). A rollback is decided — and therefore written — by runtime; identity only counts rows.",
	},
	{
		table: "services",
		writer: "project",
		readers: ["runtime", "fleet", "identity"],
		reason:
			"runtime must resolve which project a deployment belongs to and fleet must know what it is scheduling, but the service record itself is part of the project aggregate. identity reads them only to group analytics reports by service.",
	},
	{
		table: "service_dependencies",
		writer: "project",
		readers: ["runtime"],
		reason:
			"runtime has to know a service's declared dependencies to order a deployment (a dependency must be running first). project owns the declaration; runtime only reads the graph.",
	},
	{
		table: "projects",
		writer: "project",
		readers: ["runtime", "identity"],
		reason:
			"runtime groups deployments by project and resolves a project name for a docker view; identity groups analytics reports by project. Both are lookups of an id and a label — the project aggregate itself stays owned (and written) by project alone.",
	},
	{
		table: "preview_environments",
		writer: "fleet",
		readers: ["runtime"],
		reason:
			"fleet owns the preview lifecycle — it provisions, refreshes and expires a preview on the provider webhook — so fleet writes the row. runtime reads it to link a deployment to the preview it produced. Fleet writes it because the lifecycle is driven by the provider integration that lives in fleet.",
	},
	{
		table: "environments",
		writer: "project",
		readers: ["runtime"],
		reason:
			"a deployment targets an environment, so runtime cannot describe a deployment without resolving which environment it ran against. Same shape as the `services` entry: project owns the record, runtime only reads it to label the deployment.",
	},
	{
		table: "resource_ownership_index",
		writer: "fleet",
		readers: ["runtime"],
		reason:
			"runtime asks which node currently owns a resource before it schedules a deployment there. The index is fleet's view of placement, so fleet owns the rows and runtime only reads them to resolve a target.",
	},
];

/** The owner of `table`, or `undefined` if no service has claimed it. */
export function ownerOf(table: string): TableOwner | undefined {
	const owned = TABLE_OWNERSHIP[table];
	if (owned !== undefined) return owned;
	// A shared table may be declared ONLY in SHARED_TABLES (preview_environments is).
	// Its writer is its owner: the writer is the only service allowed to mutate it.
	return SHARED_TABLES.find((entry) => entry.table === table)?.writer;
}

/** Whether `table` is shared infrastructure any owner may read and write. */
export function isInfrastructure(table: string): boolean {
	return INFRASTRUCTURE_TABLES.some((entry) => entry.table === table);
}

/** Whether `service` may WRITE `table`, honouring infrastructure and shared writers. */
export function mayWrite(table: string, service: TableOwner): boolean {
	if (isInfrastructure(table)) return true;
	const shared = SHARED_TABLES.find((entry) => entry.table === table);
	if (shared !== undefined) return shared.writer === service;
	return TABLE_OWNERSHIP[table] === service;
}

/** Whether `service` may READ `table`. */
export function mayRead(table: string, service: TableOwner): boolean {
	if (isInfrastructure(table)) return true;
	const shared = SHARED_TABLES.find((entry) => entry.table === table);
	if (shared !== undefined) return shared.writer === service || shared.readers.includes(service);
	return TABLE_OWNERSHIP[table] === service;
}
