// packages/nest/schema/src/ownership/table-ownership.ts
var TABLE_OWNERSHIP2 = {
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
  deployments: "runtime",
  deployment_logs: "runtime",
  deployment_streams: "runtime",
  deployment_rollbacks: "runtime",
  deployment_rules: "runtime",
  deployment_cache: "runtime",
  preview_environments: "runtime",
  docker_image_security_scans: "runtime",
  docker_image_security_scan_history: "runtime",
  docker_image_security_lifecycle: "runtime",
  docker_runtime_activities: "runtime",
  image_project_membership: "runtime",
  github_apps: "runtime",
  github_installations: "runtime",
  github_repositories: "runtime",
  github_repository_configs: "runtime",
  github_deployment_rules: "runtime",
  github_preview_deployments: "runtime",
  github_webhook_events: "runtime",
  gitlab_apps: "runtime",
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
  health_checks: "health",
  health_check_jobs: "health",
  service_health_configs: "health",
  app_config: "platform",
  app_instances: "platform",
  schema_version: "platform",
  seed_version: "platform",
  core_event_streams: "platform",
  core_event_logs: "platform",
  local_runtime_processes: "runtime",
  local_build_cache: "runtime",
  local_queue_jobs: "runtime",
  local_event_outbox: "runtime",
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
  traefik_backups: "fleet"
};
var SHARED_TABLES2 = [
  {
    table: "deployments",
    writer: "runtime",
    readers: ["project", "fleet"],
    reason: "a project's screen shows its latest deployment and a node's shows what it hosts, so both READ it — but only runtime decides what a deployment IS. Letting project write one would give two services an opinion about a deployment's status."
  },
  {
    table: "services",
    writer: "project",
    readers: ["runtime", "fleet"],
    reason: "runtime must resolve which project a deployment belongs to and fleet must know what it is scheduling, but the service record itself is part of the project aggregate."
  }
];
function ownerOf2(table) {
  return TABLE_OWNERSHIP2[table];
}
function mayWrite2(table, service) {
  const shared = SHARED_TABLES2.find((entry) => entry.table === table);
  if (shared !== undefined)
    return shared.writer === service;
  return TABLE_OWNERSHIP2[table] === service;
}
function mayRead2(table, service) {
  const shared = SHARED_TABLES2.find((entry) => entry.table === table);
  if (shared !== undefined)
    return shared.writer === service || shared.readers.includes(service);
  return TABLE_OWNERSHIP2[table] === service;
}

export { TABLE_OWNERSHIP2, SHARED_TABLES2, ownerOf2, mayWrite2, mayRead2 };
