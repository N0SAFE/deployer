import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  uuid,
  jsonb,
  pgEnum,
  decimal,
} from "drizzle-orm/pg-core";
import { deployments, projects, services } from "./deployment";

// Enums for orchestration-related types
export const orchestrationTypeEnum = pgEnum('orchestration_type', [
  'compose',
  'swarm',
  'kubernetes'
]);

export const stackStatusEnum = pgEnum('stack_status', [
  'creating',
  'running',
  'updating',
  'removing',
  'failed',
  'paused'
]);

export const serviceHealthEnum = pgEnum('service_health', [
  'unknown',
  'healthy',
  'unhealthy',
  'starting',
  'removing'
]);

export const networkTypeEnum = pgEnum('network_type', [
  'bridge',
  'overlay',
  'host',
  'none'
]);

export const jobStatusEnum = pgEnum('job_status', [
  'waiting',
  'active',
  'completed',
  'failed',
  'delayed',
  'paused'
]);

export const jobTypeEnum = pgEnum('job_type', [
  'deploy',
  'update', 
  'remove',
  'scale',
  'build',
  'cleanup',
  'health-check',
  'ssl-renew',
  'backup',
  'restore'
]);

// Extended deployments table columns (via ALTER TABLE)
// These would be added via migration:
// ALTER TABLE deployments ADD COLUMN stack_name VARCHAR(255);
// ALTER TABLE deployments ADD COLUMN orchestration_type orchestration_type DEFAULT 'compose';
// ALTER TABLE deployments ADD COLUMN resource_allocation JSONB;
// ALTER TABLE deployments ADD COLUMN domain_config JSONB;

// Orchestration stacks - Docker Swarm stacks or Kubernetes deployments
export const orchestrationStacks = pgTable("orchestration_stacks", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(), // Stack name (project-environment format)
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  environment: text("environment").notNull(), // production, staging, preview
  orchestrationType: orchestrationTypeEnum("orchestration_type").default("swarm").notNull(),
  
  // Stack configuration
  composeConfig: jsonb("compose_config").$type<{
    version: string;
    services: Record<string, any>;
    networks?: Record<string, any>;
    volumes?: Record<string, any>;
    configs?: Record<string, any>;
    secrets?: Record<string, any>;
  }>().notNull(),
  
  // Resource management
  resourceQuotas: jsonb("resource_quotas").$type<{
    cpu: {
      limit: string;
      reservation: string;
    };
    memory: {
      limit: string;
      reservation: string;
    };
    storage: {
      limit: string;
    };
    replicas: {
      max: number;
    };
  }>(),
  
  // Domain configuration
  domainMappings: jsonb("domain_mappings").$type<{
    [serviceName: string]: {
      subdomain: string;
      fullDomain: string;
      sslEnabled: boolean;
      certificateId?: string;
    };
  }>(),
  
  // Stack status and metadata
  status: stackStatusEnum("status").default("creating").notNull(),
  lastDeployedAt: timestamp("last_deployed_at"),
  lastHealthCheck: timestamp("last_health_check"),
  errorMessage: text("error_message"),
  
  // Resource usage tracking
  currentResources: jsonb("current_resources").$type<{
    cpu: {
      used: number;
      percentage: number;
    };
    memory: {
      used: number; // bytes
      percentage: number;
    };
    storage: {
      used: number; // bytes
      percentage: number;
    };
  }>(),
  
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// Service instances - individual services within stacks
export const serviceInstances = pgTable("service_instances", {
  id: uuid("id").primaryKey().defaultRandom(),
  stackId: uuid("stack_id")
    .notNull()
    .references(() => orchestrationStacks.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id")
    .references(() => services.id, { onDelete: "set null" }), // Can be null for system services
  serviceName: text("service_name").notNull(), // e.g., "web", "api", "database"
  
  // Container configuration
  image: text("image").notNull(),
  tag: text("tag").default("latest").notNull(),
  desiredReplicas: integer("desired_replicas").default(1).notNull(),
  currentReplicas: integer("current_replicas").default(0).notNull(),
  
  // Resource limits
  resourceLimits: jsonb("resource_limits").$type<{
    cpus: string;
    memory: string;
    reservations?: {
      cpus: string;
      memory: string;
    };
  }>(),
  
  // Health monitoring
  healthStatus: serviceHealthEnum("health_status").default("unknown").notNull(),
  healthCheckConfig: jsonb("health_check_config").$type<{
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
    startPeriod?: string;
  }>(),
  lastHealthCheck: timestamp("last_health_check"),
  
  // Domain assignments
  domainAssignments: jsonb("domain_assignments").$type<{
    internal: {
      hostname: string;
      port: number;
    };
    external?: {
      domain: string;
      port: number;
      sslEnabled: boolean;
    };
  }>(),
  
  // Service metadata
  metadata: jsonb("metadata").$type<{
    containerIds: string[];
    ports: number[];
    volumes: string[];
    environment: Record<string, string>;
    labels: Record<string, string>;
    restartCount: number;
    lastRestart?: string;
  }>(),
  
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// Network assignments - track network configurations per project
export const networkAssignments = pgTable("network_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  networkName: text("network_name").notNull(),
  networkId: text("network_id").notNull(), // Docker network ID
  networkType: networkTypeEnum("network_type").default("overlay").notNull(),
  environment: text("environment").notNull(), // production, staging, preview
  
  // Network configuration
  networkConfig: jsonb("network_config").$type<{
    driver: string;
    driverOpts?: Record<string, string>;
    ipam?: {
      driver: string;
      config: {
        subnet: string;
        gateway: string;
      }[];
    };
    labels: Record<string, string>;
    attachable?: boolean;
    encrypted?: boolean;
  }>(),
  
  // Domain assignments for this network
  domainAssignments: jsonb("domain_assignments").$type<{
    baseDomain: string;
    subdomains: {
      [serviceName: string]: string;
    };
  }>(),
  
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// Resource allocations - track and enforce resource quotas
export const resourceAllocations = pgTable("resource_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  environment: text("environment").notNull(), // production, staging, preview
  
  // Resource limits
  cpuLimit: text("cpu_limit"), // e.g., "2.0"
  memoryLimit: text("memory_limit"), // e.g., "2G"
  storageLimit: text("storage_limit"), // e.g., "10G"
  
  // Current usage
  currentUsage: jsonb("current_usage").$type<{
    cpu: {
      allocated: number;
      used: number;
      percentage: number;
    };
    memory: {
      allocated: number; // bytes
      used: number; // bytes
      percentage: number;
    };
    storage: {
      allocated: number; // bytes
      used: number; // bytes
      percentage: number;
    };
    replicas: {
      total: number;
      running: number;
    };
  }>(),
  
  // Resource quotas and policies
  quotas: jsonb("quotas").$type<{
    maxCpuPerService: string;
    maxMemoryPerService: string;
    maxStoragePerService: string;
    maxReplicasPerService: number;
    maxServicesTotal: number;
    autoScaling: {
      enabled: boolean;
      cpuThreshold: number;
      memoryThreshold: number;
      scaleUpCooldown: string; // e.g., "5m"
      scaleDownCooldown: string; // e.g., "15m"
    };
  }>(),
  
  lastUpdated: timestamp("last_updated")
    .$defaultFn(() => new Date())
    .notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// SSL certificates - track SSL certificate management
export const sslCertificates = pgTable("ssl_certificates", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: text("domain").notNull().unique(),
  projectId: uuid("project_id")
    .references(() => projects.id, { onDelete: "cascade" }),
  
  // Certificate details
  certificatePath: text("certificate_path"), // Path to certificate file
  privateKeyPath: text("private_key_path"), // Path to private key file
  issuer: text("issuer").default("letsencrypt").notNull(), // letsencrypt, custom, etc.
  
  // Certificate metadata
  issuedAt: timestamp("issued_at"),
  expiresAt: timestamp("expires_at"),
  isValid: boolean("is_valid").default(true).notNull(),
  autoRenew: boolean("auto_renew").default(true).notNull(),
  
  // Certificate status
  lastRenewalAttempt: timestamp("last_renewal_attempt"),
  renewalStatus: text("renewal_status"), // success, failed, pending
  errorMessage: text("error_message"),
  
  // Metadata
  metadata: jsonb("metadata").$type<{
    subjectAlternativeNames: string[];
    keyType: string;
    keySize: number;
    fingerprint: string;
    serialNumber: string;
  }>(),
  
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// Deployment jobs - track background deployment jobs (Bull Queue)
export const deploymentJobs = pgTable("deployment_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  deploymentId: uuid("deployment_id")
    .notNull()
    .references(() => deployments.id, { onDelete: "cascade" }),
  jobType: text("job_type").notNull(), // deploy, build, cleanup, scale, etc.
  priority: integer("priority").default(0).notNull(), // Bull queue priority
  
  // Job configuration
  jobData: jsonb("job_data").$type<{
    stackConfig?: any;
    resourceQuotas?: any;
    environment?: string;
    services?: string[];
    options?: Record<string, any>;
  }>(),
  
  // Job status
  status: text("status").default("pending").notNull(), // pending, active, completed, failed
  progress: integer("progress").default(0).notNull(), // 0-100
  
  // Timing
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  estimatedDuration: integer("estimated_duration"), // seconds
  
  // Results
  result: jsonb("result").$type<{
    success: boolean;
    output?: string;
    error?: string;
    stackName?: string;
    serviceUrls?: Record<string, string>;
    resourceUsage?: any;
  }>(),
  
  // Bull queue metadata
  bullJobId: text("bull_job_id"), // Bull queue job ID
  attempts: integer("attempts").default(0).notNull(),
  maxAttempts: integer("max_attempts").default(3).notNull(),
  
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// System metrics - store system resource metrics over time
export const systemMetrics = pgTable("system_metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  
  // System resource metrics
  cpuUsage: decimal("cpu_usage", { precision: 5, scale: 2 }), // percentage
  memoryUsage: decimal("memory_usage", { precision: 10, scale: 0 }), // bytes
  memoryTotal: decimal("memory_total", { precision: 10, scale: 0 }), // bytes
  storageUsage: decimal("storage_usage", { precision: 10, scale: 0 }), // bytes
  storageTotal: decimal("storage_total", { precision: 10, scale: 0 }), // bytes
  
  // Docker metrics
  totalContainers: integer("total_containers").default(0).notNull(),
  runningContainers: integer("running_containers").default(0).notNull(),
  totalStacks: integer("total_stacks").default(0).notNull(),
  totalNetworks: integer("total_networks").default(0).notNull(),
  totalVolumes: integer("total_volumes").default(0).notNull(),
  
  // Application metrics
  activeDeployments: integer("active_deployments").default(0).notNull(),
  totalProjects: integer("total_projects").default(0).notNull(),
  totalUsers: integer("total_users").default(0).notNull(),
  
  // Network metrics
  networkTraffic: jsonb("network_traffic").$type<{
    inbound: number; // bytes
    outbound: number; // bytes
    connections: number;
  }>(),
  
  timestamp: timestamp("timestamp")
    .$defaultFn(() => new Date())
    .notNull(),
});

// Job tracking table for Bull Queue job monitoring
export const jobTracking = pgTable("job_tracking", {
  id: text("id").primaryKey(), // Bull job ID as string
  type: jobTypeEnum("type").notNull(),
  status: jobStatusEnum("status").notNull(),
  
  // Job context
  stackId: uuid("stack_id")
    .references(() => orchestrationStacks.id, { onDelete: "set null" }),
  serviceId: uuid("service_id")
    .references(() => serviceInstances.id, { onDelete: "set null" }),
  
  // Job data and configuration
  data: jsonb("data").$type<Record<string, any>>(),
  progress: integer("progress").default(0).notNull(), // 0-100
  
  // Timing information
  createdAt: timestamp("created_at").notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  failedAt: timestamp("failed_at"),
  duration: integer("duration"), // milliseconds
  
  // Job output and logs
  logs: jsonb("logs").$type<string[]>().default([]).notNull(),
  error: text("error"),
  
  // Metadata for job tracking
  metadata: jsonb("metadata").$type<{
    opts?: any;
    returnValue?: any;
    attempts?: number;
    maxAttempts?: number;
    delay?: number;
    priority?: number;
  }>(),
  
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});