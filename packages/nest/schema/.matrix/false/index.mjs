// packages/nest/schema/src/codecs/codec-registry.ts
import { Logger } from "@nestjs/common";
import { AppError } from "@deployer/errors";
import { customType } from "drizzle-orm/pg-core";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
var logger = new Logger("SchemaCodecs");
var ALGORITHM = "aes-256-gcm";
var IV_LENGTH = 16;
var SALT_LENGTH = 32;
var KEY_LENGTH = 32;
var registry = {};
function configureEncryption(provider) {
  registry.encryption = provider;
}
function configureTraefikConfigCodec(codec) {
  registry.traefik = codec;
}
function configureSchemaCodecs(config) {
  if (config.encryption !== undefined)
    configureEncryption(config.encryption);
  if (config.traefik !== undefined)
    configureTraefikConfigCodec(config.traefik);
}
function requireEncryption() {
  if (registry.encryption === undefined) {
    throw new AppError("encryptedText column used before the encryption key was configured — " + "call configureSchemaCodecs({ encryption }) at boot", "SCHEMA_CODEC_NOT_CONFIGURED");
  }
  return registry.encryption;
}
function encryptSecret(text) {
  if (!text)
    return text;
  try {
    const key = requireEncryption().resolveKey();
    const salt = randomBytes(SALT_LENGTH);
    const derived = scryptSync(key, salt, KEY_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, derived, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return `${salt.toString("hex")}:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted}`;
  } catch (error) {
    if (error instanceof AppError)
      throw error;
    logger.error("Encryption error:", { error });
    throw new AppError("Failed to encrypt data", "ENCRYPTION_ERROR");
  }
}
function parseEncryptedPayload(payload) {
  const parts = payload.split(":");
  const [saltHex, ivHex, authTagHex, encryptedData] = parts;
  if (parts.length !== 4 || saltHex === undefined || ivHex === undefined || authTagHex === undefined || encryptedData === undefined) {
    throw new AppError("Invalid encrypted data format", "ENCRYPTION_ERROR");
  }
  return { saltHex, ivHex, authTagHex, encryptedData };
}
function decryptSecret(payload) {
  if (!payload)
    return payload;
  try {
    const { saltHex, ivHex, authTagHex, encryptedData } = parseEncryptedPayload(payload);
    const salt = Buffer.from(saltHex, "hex");
    const derived = scryptSync(requireEncryption().resolveKey(), salt, KEY_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, derived, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    return decipher.update(encryptedData, "hex", "utf8") + decipher.final("utf8");
  } catch (error) {
    if (error instanceof AppError)
      throw error;
    logger.error("Decryption error:", { error });
    throw new AppError("Failed to decrypt data", "ENCRYPTION_ERROR");
  }
}
var encryptedText = customType({
  dataType() {
    return "text";
  },
  fromDriver(value) {
    return decryptSecret(value);
  },
  toDriver(value) {
    return encryptSecret(value);
  }
});
var traefikConfigBuilder = customType({
  dataType() {
    return "jsonb";
  },
  fromDriver(value) {
    return readTraefikConfig(value);
  },
  toDriver(value) {
    return writeTraefikConfig(value);
  }
});
function readTraefikConfig(value) {
  const codec = requireTraefik();
  if (!value)
    return codec.empty();
  try {
    return codec.load(value);
  } catch (error) {
    logger.error("Failed to deserialize traefik config from database", { error });
    return codec.empty();
  }
}
function writeTraefikConfig(value) {
  try {
    return JSON.stringify(requireTraefik().build(value));
  } catch (error) {
    logger.error("Failed to serialize traefik config to database", { error });
    return JSON.stringify({});
  }
}
function requireTraefik() {
  const codec = registry.traefik;
  if (codec === undefined) {
    throw new AppError("traefikConfigBuilder column used before the codec was configured — " + "call configureSchemaCodecs({ traefik }) at boot", "SCHEMA_CODEC_NOT_CONFIGURED");
  }
  return codec;
}
function generateEncryptionKey() {
  return randomBytes(32).toString("hex");
}
// packages/nest/schema/src/migrations.ts
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var LOCAL_MIGRATIONS_DIR = resolveLocalMigrationsDir();
function resolveLocalMigrationsDir() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;; ) {
    const candidate = join(dir, "migrations", "local");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Local migrations directory not found above ${fileURLToPath(import.meta.url)}`);
    }
    dir = parent;
  }
}
var GLOBAL_MIGRATIONS_DIR = resolveGlobalMigrationsDir();
function resolveGlobalMigrationsDir() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;; ) {
    const candidate = join(dir, "migrations", "global");
    if (existsSync(join(candidate, "meta", "_journal.json"))) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Global migrations directory not found above ${fileURLToPath(import.meta.url)}`);
    }
    dir = parent;
  }
}
// packages/nest/schema/src/ownership/table-ownership.ts
var TABLE_OWNERSHIP = {
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
var SHARED_TABLES = [
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
function ownerOf(table) {
  return TABLE_OWNERSHIP[table];
}
function mayWrite(table, service) {
  const shared = SHARED_TABLES.find((entry) => entry.table === table);
  if (shared !== undefined)
    return shared.writer === service;
  return TABLE_OWNERSHIP[table] === service;
}
function mayRead(table, service) {
  const shared = SHARED_TABLES.find((entry) => entry.table === table);
  if (shared !== undefined)
    return shared.writer === service || shared.readers.includes(service);
  return TABLE_OWNERSHIP[table] === service;
}
export {
  GLOBAL_MIGRATIONS_DIR,
  LOCAL_MIGRATIONS_DIR,
  SHARED_TABLES,
  TABLE_OWNERSHIP,
  configureEncryption,
  configureSchemaCodecs,
  configureTraefikConfigCodec,
  decryptSecret,
  encryptSecret,
  encryptedText,
  generateEncryptionKey,
  mayRead,
  mayWrite,
  ownerOf,
  readTraefikConfig,
  traefikConfigBuilder
};
