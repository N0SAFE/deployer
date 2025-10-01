import { Command, CommandRunner } from "nest-commander";
import { Injectable, Inject } from "@nestjs/common";
import { AUTH_INSTANCE_KEY } from "@/core/modules/auth/types/symbols";
import type { Auth } from "@/auth";
import { nanoid } from "nanoid";
import { roles } from "../../config/auth/permissions/statements"; // Correct relative path

import {
  projects,
  services,
  serviceDependencies,
  projectCollaborators,
  systemStatus,
  traefikServiceConfigs,
  traefikDomainRoutes,
  traefikServiceTargets,
  traefikMiddlewares,
  traefikConfigFiles,
  domainConfigs,
  routeConfigs,
  traefikConfigs,
  configFiles,
  traefikStaticConfigs,
  traefikMiddleware,
  traefikPlugins,
  traefikStaticFiles,
  traefikBackups,
  environments,
  type CreateTraefikMiddleware,
  type CreateTraefikPlugin,
  type CreateTraefikStaticFile,
} from "@/config/drizzle/schema";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { DatabaseService } from "@/core/modules/database/services/database.service";

// Interface for service data used in this.createServiceWithTraefik function
interface ServiceData {
  id?: string;
  projectId: string;
  name: string;
  type: string;
  provider:
    | "github"
    | "gitlab"
    | "bitbucket"
    | "gitea"
    | "docker_registry"
    | "s3_bucket"
    | "manual";
  builder:
    | "dockerfile"
    | "nixpack"
    | "railpack"
    | "buildpack"
    | "static"
    | "docker_compose";
  providerConfig: {
    repositoryUrl?: string;
    branch?: string;
    accessToken?: string;
    deployKey?: string;
    registryUrl?: string;
    imageName?: string;
    tag?: string;
    username?: string;
    password?: string;
    bucketName?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    objectKey?: string;
    instructions?: string;
    deploymentScript?: string;
  };
  builderConfig?: {
    dockerfilePath?: string;
    buildContext?: string;
    buildArgs?: Record<string, string>;
    buildCommand?: string;
    startCommand?: string;
    installCommand?: string;
    outputDirectory?: string;
    composeFilePath?: string;
    serviceName?: string;
  };
  port?: number;
  healthCheckPath?: string;
  environmentVariables?: Record<string, string>;
  resourceLimits?: {
    memory?: string;
    cpu?: string;
    storage?: string;
  };
}

@Injectable()
@Command({
  name: "seed",
  description: "Seed the database with initial data",
})
export class SeedCommand extends CommandRunner {
  constructor(
    @Inject(AUTH_INSTANCE_KEY)
    private readonly auth: Auth,
    private readonly databaseService: DatabaseService
  ) {
    super();
  }

  // Helper function to create service with Traefik configuration
  async createServiceWithTraefik(
    serviceData: ServiceData,
    projectId: string,
    projectDomain: string
  ) {
    // Create the service in database
    const [service] = await this.databaseService.db
      .insert(services)
      .values({
        ...serviceData,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    console.log(`✅ Created service: ${service.name}`);
    // Create Traefik configuration for this service
    if (service.port) {
      // Create domain configuration
      const domainConfig = {
        id: randomUUID(),
        projectId: projectId,
        domain: projectDomain,
        subdomain: service.name,
        fullDomain: `${service.name}.${projectDomain}`,
        sslEnabled: false, // No SSL for localhost
        sslProvider: null,
        middleware: {
          cors: {
            accessControlAllowOrigin: [
              `http://${projectDomain}`,
              "http://localhost:3000",
            ],
            accessControlAllowMethods: ["GET", "POST", "PUT", "DELETE"],
            accessControlAllowHeaders: ["Content-Type", "Authorization"],
          },
        },
        dnsStatus: "valid" as const, // localhost is always valid
        dnsRecords: null,
        dnsLastChecked: new Date(),
        dnsErrorMessage: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const [insertedDomainConfig] = await this.databaseService.db
        .insert(domainConfigs)
        .values(domainConfig)
        .returning();
      console.log(`✅ Created domain config: ${domainConfig.fullDomain}`);
      // Create route configuration
      const routeConfig = {
        id: randomUUID(),
        domainConfigId: insertedDomainConfig.id,
        deploymentId: null, // Will be set when deployment is created
        routeName: `${service.name}-route`,
        serviceName: `${service.name}-service`,
        containerName: `${service.name}-container`,
        targetPort: service.port,
        pathPrefix: "/",
        priority: 1,
        middleware: {
          rateLimit: {
            burst: 100,
            rate: "10/s",
          },
        },
        healthCheck: service.healthCheckPath
          ? {
              path: service.healthCheckPath,
              interval: "30s",
              timeout: "10s",
              retries: 3,
            }
          : null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await this.databaseService.db.insert(routeConfigs).values(routeConfig);
      console.log(`✅ Created route config: ${routeConfig.routeName}`);
      // Create Traefik configuration file for this service
      const traefikConfigContent = `# Traefik configuration for ${service.name}
http:
  services:
    ${routeConfig.serviceName}:
      loadBalancer:
        servers:
          - url: "http://${routeConfig.containerName}:${routeConfig.targetPort}"

  routers:
    ${routeConfig.routeName}:
      rule: "Host(\`${domainConfig.fullDomain}\`)"
      service: "${routeConfig.serviceName}"
      entryPoints:
        - "web"
      middlewares:
        - "${service.name}-cors"
        - "${service.name}-ratelimit"

  middlewares:
    ${service.name}-cors:
      headers:
        accessControlAllowMethods:
          - "GET"
          - "POST"
          - "PUT"
          - "DELETE"
          - "OPTIONS"
        accessControlAllowOriginList:
          - "http://${projectDomain}"
          - "http://localhost:3000"
        accessControlAllowHeaders:
          - "Content-Type"
          - "Authorization"
    ${service.name}-ratelimit:
      rateLimit:
        burst: 100
        period: "1s"
        average: 10`;
      const traefikConfigRecord = {
        id: randomUUID(),
        projectId: projectId,
        configName: `${service.name}-config`,
        configContent: traefikConfigContent,
        configType: "dynamic" as const,
        storageType: "project" as const,
        requiresFile: true,
        syncStatus: "pending" as const,
        lastSyncedAt: null,
        syncErrorMessage: null,
        fileChecksum: null,
        configVersion: 1,
        metadata: {
          serviceName: service.name,
          serviceId: service.id,
          projectId: projectId,
        },
        description: `Configuration for ${service.name} service`,
        tags: [service.name, "service-config"],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await this.databaseService.db
        .insert(traefikConfigs)
        .values(traefikConfigRecord);
      console.log(
        `✅ Created Traefik config: ${traefikConfigRecord.configName}`
      );
    }
    return service;
  }

  async run(): Promise<void> {
    console.log("🌱 Seeding database...");

    try {
      // Dynamically get roles from permissions
      const roleNames = Object.keys(roles) as (keyof typeof roles)[];
      const usersPerRole = 2;
      // Check if database has already been seeded
      const existingStatus = await this.databaseService.db
        .select()
        .from(systemStatus)
        .where(eq(systemStatus.id, "system"))
        .limit(1);
      if (existingStatus.length > 0 && existingStatus[0].isSeeded) {
        console.log("✅ Database already seeded. Skipping seeding process.");
        console.log(`📅 Last seeded at: ${existingStatus[0].lastSeededAt}`);
        console.log(`📦 Seed version: ${existingStatus[0].seedVersion}`);
        return;
      }
      console.log("🌱 Database not seeded yet. Starting seeding process...");
      const usersCreationPromises: Promise<Awaited<ReturnType<typeof this.auth.api.createUser>>['user']>[] = [];
      // Create sample users
      for (const roleKey of roleNames) {
        const role = roleKey as string; // Type assertion
        for (let i = 1; i <= usersPerRole; i++) {
          const email = `${role}${i}@test.com`;
          const password = "password123";
          usersCreationPromises.push(
            new Promise(async (resolve) => {
              const userResult = await this.auth.api.createUser({
                body: {
                  name: `${role.charAt(0).toUpperCase() + role.slice(1)} User ${i}`,
                  email,
                  password,
                  data: {
                    role,
                    emailVerified: true,
                    image: `https://avatars.githubusercontent.com/u/${i}?v=4`,
                  },
                },
              });
              const user = userResult.user;

              // Generate API key data (no DB insert; log for dev use)
              const apiKeyData = {
                userId: user.id,
                name: `${role}-key-${i}`,
                key: nanoid(32),
                expiresAt: null,
                abilities:
                  role === "superAdmin" || role === "admin"
                    ? ["*"]
                    : role === "manager" || role === "editor"
                      ? ["read", "write"]
                      : ["read"],
              };

              // Note: api_keys table not present; skipping insert. Use logged keys for auth.
              console.warn(
                `API key generated for ${role} user ${i} (no DB table; use logged key): ${apiKeyData.key}`
              );

              resolve(user);
            })
          );
        }
      }
      const insertedUsers = await Promise.all(usersCreationPromises);
      console.log("✅ Created sample users");
      console.log(
        "ℹ️  Skipping Traefik instance creation (using project-based approach)"
      );
      // Create sample projects
      const sampleProjects = [
        {
          id: "27c3ad1e-d5d7-4afb-9e8b-27646a387268",
          name: "My Blog",
          description: "Personal blog with Next.js frontend and NestJS API",
          baseDomain: "my-blog.localhost",
          ownerId: insertedUsers[0].id,
          settings: {
            autoCleanupDays: 7,
            maxPreviewEnvironments: 5,
            defaultEnvironmentVariables: {
              NODE_ENV: "development",
              PORT: "3000",
            },
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          name: "E-commerce Store",
          description:
            "Online store with React frontend, Node.js API, and PostgreSQL",
          baseDomain: "shop.localhost",
          ownerId: insertedUsers[1].id,
          settings: {
            autoCleanupDays: 14,
            maxPreviewEnvironments: 10,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const insertedProjects = await this.databaseService.db
        .insert(projects)
        .values(sampleProjects)
        .returning();
      console.log("✅ Created sample projects");

      // Create sample environments for the projects
      console.log("🌍 Creating sample environments...");
      const sampleEnvironments = [
        {
          name: "Production",
          slug: "production",
          description: "Production environment for live applications",
          type: "production" as const,
          status: "healthy" as const,
          projectId: insertedProjects[0].id, // Associate with blog project
          domainConfig: {
            baseDomain: "example.com",
            sslEnabled: true,
          },
          networkConfig: {
            corsOrigins: ["https://example.com"],
            rateLimit: 1000,
          },
          deploymentConfig: {
            autoDeployEnabled: true,
            deploymentStrategy: "rolling" as const,
          },
          resourceLimits: {
            memory: "2GB",
            cpu: "1000m",
          },
          metadata: {
            serviceCount: 0,
            deploymentCount: 0,
            accessCount: 0,
            tags: ["production", "live"],
          },
          isActive: true,
          createdBy: insertedUsers[0].id,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          name: "Staging",
          slug: "staging",
          description: "Staging environment for testing",
          type: "staging" as const,
          status: "healthy" as const,
          projectId: insertedProjects[0].id,
          domainConfig: {
            baseDomain: "staging.example.com",
            sslEnabled: true,
          },
          networkConfig: {
            corsOrigins: ["https://staging.example.com"],
            rateLimit: 500,
          },
          deploymentConfig: {
            autoDeployEnabled: true,
            deploymentStrategy: "recreate" as const,
          },
          resourceLimits: {
            memory: "1GB",
            cpu: "500m",
          },
          metadata: {
            serviceCount: 0,
            deploymentCount: 0,
            accessCount: 0,
            tags: ["staging", "testing"],
          },
          isActive: true,
          createdBy: insertedUsers[0].id,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          name: "Development",
          slug: "development",
          description: "Development environment for local testing",
          type: "development" as const,
          status: "healthy" as const,
          projectId: insertedProjects[1].id, // Associate with portfolio project
          domainConfig: {
            baseDomain: "dev.example.com",
            sslEnabled: false,
          },
          networkConfig: {
            corsOrigins: ["http://localhost:3000"],
            rateLimit: 100,
          },
          deploymentConfig: {
            autoDeployEnabled: false,
            deploymentStrategy: "recreate" as const,
          },
          resourceLimits: {
            memory: "512MB",
            cpu: "250m",
          },
          metadata: {
            serviceCount: 0,
            deploymentCount: 0,
            accessCount: 0,
            tags: ["development", "local"],
          },
          isActive: true,
          createdBy: insertedUsers[0].id,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const insertedEnvironments = await this.databaseService.db
        .insert(environments)
        .values(sampleEnvironments)
        .returning();
      console.log("✅ Created sample environments");
      console.log(
        "📋 Environments created:",
        insertedEnvironments
          .map((env) => `${env.name} (${env.slug})`)
          .join(", ")
      );

      // Create sample services for the first project using Traefik integration
      console.log("🚀 Creating services with Traefik configuration...");
      // API Service for blog project
      const apiService = await this.createServiceWithTraefik(
        {
          projectId: insertedProjects[0].id,
          name: "api",
          type: "backend",
          provider: "github" as const,
          builder: "dockerfile" as const,
          providerConfig: {
            repositoryUrl: "https://github.com/example/api-service",
            branch: "main",
          },
          builderConfig: {
            dockerfilePath: "apps/api/Dockerfile",
            buildContext: ".",
          },
          port: 3001,
          healthCheckPath: "/health",
          environmentVariables: {
            DATABASE_URL:
              "postgresql://user:pass@this.databaseService.db:5432/mydb",
            REDIS_URL: "redis://redis:6379",
          } as Record<string, string>,
          resourceLimits: {
            memory: "512m",
            cpu: "0.5",
          },
        },
        insertedProjects[0].id,
        insertedProjects[0].baseDomain || "localhost"
      );
      // Web Service for blog project
      const webService = await this.createServiceWithTraefik(
        {
          projectId: insertedProjects[0].id,
          name: "web",
          type: "frontend",
          provider: "github" as const,
          builder: "nixpack" as const,
          providerConfig: {
            repositoryUrl: "https://github.com/example/web-app",
            branch: "main",
          },
          builderConfig: {
            buildCommand: "npm run build",
            outputDirectory: ".next",
          },
          port: 3000,
          healthCheckPath: "/",
          environmentVariables: {
            NEXT_PUBLIC_API_URL: "http://api.my-blog.localhost",
          } as Record<string, string>,
          resourceLimits: {
            memory: "256m",
            cpu: "0.3",
          },
        },
        insertedProjects[0].id,
        insertedProjects[0].baseDomain || "localhost"
      );
      const insertedServices = [apiService, webService];
      console.log("✅ Created sample services with Traefik configuration");

      // Create service-based Traefik configurations for the services
      console.log("🔧 Creating service-based Traefik configurations...");

      // Service-based config for API service
      const apiTraefikConfig = {
        id: randomUUID(),
        serviceId: apiService.id,
        domain: insertedProjects[0].baseDomain || "my-blog.localhost",
        subdomain: "api",
        fullDomain: `api.${insertedProjects[0].baseDomain || "my-blog.localhost"}`,
        sslEnabled: false,
        sslProvider: null,
        pathPrefix: "/",
        port: apiService.port!,
        middleware: {
          cors: {
            accessControlAllowOrigin: [
              `http://${insertedProjects[0].baseDomain || "my-blog.localhost"}`,
              "http://localhost:3000",
            ],
            accessControlAllowMethods: [
              "GET",
              "POST",
              "PUT",
              "DELETE",
              "OPTIONS",
            ],
            accessControlAllowHeaders: [
              "Content-Type",
              "Authorization",
              "X-Requested-With",
            ],
          },
          rateLimit: {
            burst: 100,
            rate: "50/s",
          },
        },
        healthCheck: {
          enabled: true,
          path: apiService.healthCheckPath || "/health",
          interval: 30,
          timeout: 10,
        },
        isActive: true,
        configContent: `# Service-based Traefik configuration for ${apiService.name}
http:
  services:
    ${apiService.name}-service:
      loadBalancer:
        servers:
          - url: "http://${apiService.name}:${apiService.port}"
        healthCheck:
          path: "${apiService.healthCheckPath || "/health"}"
          interval: "30s"
          timeout: "10s"

  routers:
    ${apiService.name}-router:
      rule: "Host(\`api.${insertedProjects[0].baseDomain || "my-blog.localhost"}\`)"
      service: "${apiService.name}-service"
      entryPoints:
        - "web"
      middlewares:
        - "${apiService.name}-cors"
        - "${apiService.name}-ratelimit"

  middlewares:
    ${apiService.name}-cors:
      headers:
        accessControlAllowMethods:
          - "GET"
          - "POST"
          - "PUT"
          - "DELETE"
          - "OPTIONS"
        accessControlAllowOriginList:
          - "http://${insertedProjects[0].baseDomain || "my-blog.localhost"}"
          - "http://localhost:3000"
        accessControlAllowHeaders:
          - "Content-Type"
          - "Authorization"
          - "X-Requested-With"
    ${apiService.name}-ratelimit:
      rateLimit:
        burst: 100
        period: "1s"
        average: 50`,
        lastSyncedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Service-based config for Web service
      const webTraefikConfig = {
        id: randomUUID(),
        serviceId: webService.id,
        domain: insertedProjects[0].baseDomain || "my-blog.localhost",
        subdomain: "web",
        fullDomain: `web.${insertedProjects[0].baseDomain || "my-blog.localhost"}`,
        sslEnabled: false,
        sslProvider: null,
        pathPrefix: "/",
        port: webService.port!,
        middleware: {
          compression: {
            enabled: true,
            types: [
              "text/html",
              "text/css",
              "text/javascript",
              "application/javascript",
              "application/json",
            ],
          },
          headers: {
            customHeaders: {
              "X-Frame-Options": "SAMEORIGIN",
              "X-Content-Type-Options": "nosniff",
              "X-XSS-Protection": "1; mode=block",
            },
          },
        },
        healthCheck: {
          enabled: true,
          path: webService.healthCheckPath || "/",
          interval: 60,
          timeout: 15,
        },
        isActive: true,
        configContent: `# Service-based Traefik configuration for ${webService.name}
http:
  services:
    ${webService.name}-service:
      loadBalancer:
        servers:
          - url: "http://${webService.name}:${webService.port}"
        healthCheck:
          path: "${webService.healthCheckPath || "/"}"
          interval: "60s"
          timeout: "15s"

  routers:
    ${webService.name}-router:
      rule: "Host(\`web.${insertedProjects[0].baseDomain || "my-blog.localhost"}\`)"
      service: "${webService.name}-service"
      entryPoints:
        - "web"
      middlewares:
        - "${webService.name}-compression"
        - "${webService.name}-security-headers"

  middlewares:
    ${webService.name}-compression:
      compress:
        excludedContentTypes:
          - "image/png"
          - "image/jpeg"
          - "image/gif"
    ${webService.name}-security-headers:
      headers:
        customRequestHeaders:
          X-Frame-Options: "SAMEORIGIN"
          X-Content-Type-Options: "nosniff"
          X-XSS-Protection: "1; mode=block"`,
        lastSyncedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const insertedServiceConfigs = await this.databaseService.db
        .insert(traefikServiceConfigs)
        .values([apiTraefikConfig, webTraefikConfig])
        .returning();
      console.log("✅ Created service-based Traefik configurations");

      // Create domain routes for each service config
      const apiDomainRoute = {
        id: randomUUID(),
        configId: insertedServiceConfigs[0].id,
        hostRule: `Host(\`api.${insertedProjects[0].baseDomain || "my-blog.localhost"}\`)`,
        pathRule: null,
        method: null,
        headers: null,
        priority: 10,
        entryPoint: "web",
        middleware: {
          chain: ["api-cors", "api-ratelimit"],
        },
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const webDomainRoute = {
        id: randomUUID(),
        configId: insertedServiceConfigs[1].id,
        hostRule: `Host(\`web.${insertedProjects[0].baseDomain || "my-blog.localhost"}\`)`,
        pathRule: null,
        method: null,
        headers: null,
        priority: 10,
        entryPoint: "web",
        middleware: {
          chain: ["web-compression", "web-security-headers"],
        },
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.databaseService.db
        .insert(traefikDomainRoutes)
        .values([apiDomainRoute, webDomainRoute]);
      console.log("✅ Created domain routes for service configs");

      // Create service targets for load balancing
      const apiServiceTarget = {
        id: randomUUID(),
        configId: insertedServiceConfigs[0].id,
        url: `http://${apiService.name}:${apiService.port}`,
        weight: 1,
        healthCheck: {
          enabled: true,
          path: apiService.healthCheckPath || "/health",
          interval: 30,
          timeout: 10,
          retries: 3,
        },
        isActive: true,
        lastHealthCheck: new Date(),
        healthStatus: "healthy" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const webServiceTarget = {
        id: randomUUID(),
        configId: insertedServiceConfigs[1].id,
        url: `http://${webService.name}:${webService.port}`,
        weight: 1,
        healthCheck: {
          enabled: true,
          path: webService.healthCheckPath || "/",
          interval: 60,
          timeout: 15,
          retries: 2,
        },
        isActive: true,
        lastHealthCheck: new Date(),
        healthStatus: "healthy" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.databaseService.db
        .insert(traefikServiceTargets)
        .values([apiServiceTarget, webServiceTarget]);
      console.log("✅ Created service targets for load balancing");

      // Create reusable middleware definitions
      const middlewareDefinitions = [
        {
          id: randomUUID(),
          name: "cors-api",
          type: "headers" as const,
          config: {
            accessControlAllowMethods: [
              "GET",
              "POST",
              "PUT",
              "DELETE",
              "OPTIONS",
            ],
            accessControlAllowOriginList: [
              `http://${insertedProjects[0].baseDomain || "my-blog.localhost"}`,
              "http://localhost:3000",
            ],
            accessControlAllowHeaders: [
              "Content-Type",
              "Authorization",
              "X-Requested-With",
            ],
          },
          description: "CORS headers for API services",
          isGlobal: false,
          serviceId: apiService.id,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: randomUUID(),
          name: "ratelimit-api",
          type: "ratelimit" as const,
          config: {
            burst: 100,
            period: "1s",
            average: 50,
          },
          description: "Rate limiting for API services",
          isGlobal: false,
          serviceId: apiService.id,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: randomUUID(),
          name: "compression-web",
          type: "compression" as const,
          config: {
            excludedContentTypes: [
              "image/png",
              "image/jpeg",
              "image/gif",
              "image/webp",
            ],
          },
          description: "Compression for web services",
          isGlobal: false,
          serviceId: webService.id,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: randomUUID(),
          name: "security-headers",
          type: "headers" as const,
          config: {
            customRequestHeaders: {
              "X-Frame-Options": "SAMEORIGIN",
              "X-Content-Type-Options": "nosniff",
              "X-XSS-Protection": "1; mode=block",
              "Strict-Transport-Security":
                "max-age=31536000; includeSubDomains",
            },
          },
          description: "Security headers for all services",
          isGlobal: true,
          serviceId: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      await this.databaseService.db
        .insert(traefikMiddlewares)
        .values(middlewareDefinitions);
      console.log("✅ Created middleware definitions");

      // Create config files for the service-based configurations
      const apiConfigFile = {
        id: randomUUID(),
        configId: insertedServiceConfigs[0].id,
        fileName: `${apiService.name}-service-config.yml`,
        filePath: `/etc/traefik/dynamic/services/${apiService.name}-service-config.yml`,
        relativePath: `services/${apiService.name}-service-config.yml`,
        fileType: "traefik" as const,
        contentType: "application/yaml",
        size: Buffer.byteLength(apiTraefikConfig.configContent, "utf8"),
        checksum: null,
        content: apiTraefikConfig.configContent,
        lastSynced: new Date(),
        syncStatus: "synced" as const,
        syncError: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const webConfigFile = {
        id: randomUUID(),
        configId: insertedServiceConfigs[1].id,
        fileName: `${webService.name}-service-config.yml`,
        filePath: `/etc/traefik/dynamic/services/${webService.name}-service-config.yml`,
        relativePath: `services/${webService.name}-service-config.yml`,
        fileType: "traefik" as const,
        contentType: "application/yaml",
        size: Buffer.byteLength(webTraefikConfig.configContent, "utf8"),
        checksum: null,
        content: webTraefikConfig.configContent,
        lastSynced: new Date(),
        syncStatus: "synced" as const,
        syncError: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.databaseService.db
        .insert(traefikConfigFiles)
        .values([apiConfigFile, webConfigFile]);
      console.log("✅ Created service-based config files");
      // Create static file service for testing local file deployment
      const staticFileContent = {
        "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Static Site Demo</title>
    <style>
        body { 
            font-family: Arial, sans-serif; 
            max-width: 800px; 
            margin: 0 auto; 
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
        }
        .container { 
            background: rgba(255,255,255,0.1); 
            padding: 30px; 
            border-radius: 10px;
            backdrop-filter: blur(10px);
        }
        h1 { color: #fff; text-align: center; }
        .status { 
            background: rgba(76, 175, 80, 0.2); 
            padding: 15px; 
            border-radius: 5px; 
            margin: 20px 0;
            border-left: 4px solid #4CAF50;
        }
        .feature { 
            background: rgba(33, 150, 243, 0.2); 
            padding: 10px; 
            margin: 10px 0; 
            border-radius: 5px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Static Site Deployment Demo</h1>
        <div class="status">
            <h3>✅ Deployment Successful!</h3>
            <p>This static site was deployed using the local file upload feature.</p>
        </div>
        
        <div class="feature">
            <h4>📁 File Structure</h4>
            <p>This site includes multiple files served from Docker volumes.</p>
        </div>
        
        <div class="feature">
            <h4>🔗 Navigation</h4>
            <p><a href="/about.html" style="color: #81C784;">Visit About Page</a></p>
        </div>
        
        <div class="feature">
            <h4>🎯 Features Tested</h4>
            <ul>
                <li>Local file upload processing</li>
                <li>Static file serving via Traefik</li>
                <li>Docker volume integration</li>
                <li>Multi-file deployment</li>
            </ul>
        </div>
    </div>
</body>
</html>`,
        "about.html": `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>About - Static Site Demo</title>
    <style>
        body { 
            font-family: Arial, sans-serif; 
            max-width: 800px; 
            margin: 0 auto; 
            padding: 20px;
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            color: white;
            min-height: 100vh;
        }
        .container { 
            background: rgba(255,255,255,0.1); 
            padding: 30px; 
            border-radius: 10px;
            backdrop-filter: blur(10px);
        }
        h1 { color: #fff; text-align: center; }
        a { color: #FFE082; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📋 About This Demo</h1>
        <p>This is a demonstration of the static file deployment system.</p>
        
        <h3>🔧 Technical Details</h3>
        <ul>
            <li><strong>Provider:</strong> Local file upload</li>
            <li><strong>Storage:</strong> Docker volumes</li>
            <li><strong>Serving:</strong> Nginx container</li>
            <li><strong>Proxy:</strong> Traefik reverse proxy</li>
        </ul>
        
        <h3>📊 Deployment Info</h3>
        <p><strong>Service:</strong> static-demo</p>
        <p><strong>Domain:</strong> static.localhost</p>
        <p><strong>Files:</strong> HTML, CSS (inline)</p>
        
        <p><a href="/index.html">← Back to Home</a></p>
    </div>
</body>
</html>`,
        "robots.txt": `User-agent: *
Allow: /

Sitemap: http://static.localhost/sitemap.xml`,
        "sitemap.xml": `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>http://static.localhost/</loc>
    <lastmod>${new Date().toISOString().split("T")[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>http://static.localhost/about.html</loc>
    <lastmod>${new Date().toISOString().split("T")[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>`,
      };
      // Static Service for testing local file deployment
      const staticService = await this.createServiceWithTraefik(
        {
          id: 'aaaabdf8-5731-4380-86b0-c884e2c55d64',
          projectId: insertedProjects[0].id,
          name: "static-demo",
          type: "frontend",
          provider: "manual" as const,
          builder: "static" as const,
          providerConfig: {
            instructions: "Static file deployment with local content",
            deploymentScript: JSON.stringify(staticFileContent),
          },
          builderConfig: {
            outputDirectory: "/",
          },
          port: 80,
          healthCheckPath: "/",
          environmentVariables: {} as Record<string, string>,
          resourceLimits: {
            memory: "64m",
            cpu: "0.1",
          },
        },
        insertedProjects[0].id,
        insertedProjects[0].baseDomain || "localhost"
      );
      const insertedStaticService = [staticService];
      console.log("✅ Created static file service with Traefik configuration");

      // Add static service to service-based Traefik configurations
      console.log(
        "🔧 Adding static service to service-based Traefik configurations..."
      );

      const staticTraefikConfig = {
        id: randomUUID(),
        serviceId: staticService.id,
        domain: insertedProjects[0].baseDomain || "my-blog.localhost",
        subdomain: "static-demo",
        fullDomain: `static-demo-${insertedProjects[0].baseDomain || "my-blog.localhost"}`,
        sslEnabled: false,
        sslProvider: null,
        pathPrefix: "/",
        port: staticService.port!,
        middleware: {
          headers: {
            customHeaders: {
              "X-Frame-Options": "SAMEORIGIN",
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": "public, max-age=3600",
            },
          },
        },
        healthCheck: {
          enabled: true,
          path: staticService.healthCheckPath || "/",
          interval: 120,
          timeout: 10,
        },
        isActive: true,
        configContent: `# Service-based Traefik configuration for ${staticService.name}
http:
  services:
    ${staticService.name}-service:
      loadBalancer:
        servers:
          - url: "http://${staticService.name}:${staticService.port}"
        healthCheck:
          path: "${staticService.healthCheckPath || "/"}"
          interval: "120s"
          timeout: "10s"

  routers:
    ${staticService.name}-router:
      rule: "Host(\`static-demo-${insertedProjects[0].baseDomain || "my-blog.localhost"}\`)"
      service: "${staticService.name}-service"
      entryPoints:
        - "web"
      middlewares:
        - "${staticService.name}-security-headers"

  middlewares:
    ${staticService.name}-security-headers:
      headers:
        customRequestHeaders:
          X-Frame-Options: "SAMEORIGIN"
          X-Content-Type-Options: "nosniff"
          Cache-Control: "public, max-age=3600"`,
        lastSyncedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const insertedStaticServiceConfig = await this.databaseService.db
        .insert(traefikServiceConfigs)
        .values(staticTraefikConfig)
        .returning();
      console.log(
        "✅ Added static service to service-based Traefik configurations"
      );

      // Add static service to related Traefik tables
      const staticDomainRoute = {
        id: randomUUID(),
        configId: insertedStaticServiceConfig[0].id,
        hostRule: `Host(\`static-demo-${insertedProjects[0].baseDomain || "my-blog.localhost"}\`)`,
        pathRule: null,
        method: null,
        headers: null,
        priority: 8,
        entryPoint: "web",
        middleware: {
          chain: ["static-demo-security-headers"],
        },
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.databaseService.db
        .insert(traefikDomainRoutes)
        .values(staticDomainRoute);

      const staticServiceTarget = {
        id: randomUUID(),
        configId: insertedStaticServiceConfig[0].id,
        url: `http://${staticService.name}:${staticService.port}`,
        weight: 100,
        healthCheck: {
          enabled: true,
          path: staticService.healthCheckPath || "/",
          interval: 120,
          timeout: 10,
          retries: 3,
          startPeriod: 30,
        },
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.databaseService.db
        .insert(traefikServiceTargets)
        .values(staticServiceTarget);

      const staticMiddleware = {
        id: randomUUID(),
        name: "static-demo-security-headers",
        type: "headers" as const,
        config: {
          customRequestHeaders: {
            "X-Frame-Options": "SAMEORIGIN",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "public, max-age=3600",
          },
        },
        description: "Security headers for static demo service",
        isGlobal: false,
        serviceId: staticService.id,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.databaseService.db
        .insert(traefikMiddlewares)
        .values(staticMiddleware);

      const staticConfigFile = {
        id: randomUUID(),
        configId: insertedStaticServiceConfig[0].id,
        fileName: `${staticService.name}-service-config.yml`,
        filePath: `/etc/traefik/dynamic/services/${staticService.name}-service-config.yml`,
        relativePath: `services/${staticService.name}-service-config.yml`,
        fileType: "traefik" as const,
        contentType: "application/yaml",
        size: Buffer.byteLength(staticTraefikConfig.configContent, "utf8"),
        checksum: null,
        content: staticTraefikConfig.configContent,
        lastSynced: new Date(),
        syncStatus: "synced" as const,
        syncError: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.databaseService.db
        .insert(traefikConfigFiles)
        .values(staticConfigFile);
      console.log("✅ Added static service to all related Traefik tables");

      // Create service dependency (web depends on api)
      const serviceDependency = {
        serviceId: insertedServices[1].id, // web
        dependsOnServiceId: insertedServices[0].id, // api
        isRequired: true,
        createdAt: new Date(),
      };
      await this.databaseService.db
        .insert(serviceDependencies)
        .values(serviceDependency);
      console.log("✅ Created service dependencies");
      // Add collaborator to first project
      const collaboration = {
        projectId: insertedProjects[0].id,
        userId: insertedUsers[1].id,
        role: "developer" as const,
        permissions: {
          canDeploy: true,
          canManageServices: false,
          canManageCollaborators: false,
          canViewLogs: true,
          canDeleteDeployments: false,
        },
        invitedBy: insertedUsers[0].id,
        invitedAt: new Date(),
        acceptedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await this.databaseService.db
        .insert(projectCollaborators)
        .values(collaboration);
      console.log("✅ Created project collaborations");
      // Create test Traefik configuration for test.localhost → google.com
      const testDomainConfig = {
        id: randomUUID(),
        projectId: insertedProjects[0].id, // Use first project as parent
        domain: "localhost",
        subdomain: "test",
        fullDomain: "test.localhost",
        sslEnabled: false, // No SSL for localhost testing
        sslProvider: null,
        middleware: {
          redirectToHttps: false,
          cors: {
            accessControlAllowOrigin: ["*"],
            accessControlAllowMethods: [
              "GET",
              "POST",
              "PUT",
              "DELETE",
              "OPTIONS",
            ],
            accessControlAllowHeaders: ["*"],
          },
        },
        dnsStatus: "valid" as const,
        dnsRecords: null,
        dnsLastChecked: new Date(),
        dnsErrorMessage: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const insertedTestDomainConfigs = await this.databaseService.db
        .insert(domainConfigs)
        .values(testDomainConfig)
        .returning();
      console.log("✅ Created test.localhost domain configuration");
      // Create test route configuration that redirects to google.com
      const testRouteConfig = {
        id: randomUUID(),
        domainConfigId: insertedTestDomainConfigs[0].id,
        deploymentId: null, // No deployment, this is a redirect
        routeName: "test-redirect-route",
        serviceName: "redirect-to-google",
        containerName: null,
        targetPort: 80, // Required field, use port 80 for redirect service
        pathPrefix: "/",
        priority: 1,
        middleware: {
          redirect: {
            regex: "^https?://test\\.localhost/(.*)",
            replacement: "https://google.com/$1",
            permanent: false, // Temporary redirect for testing
          },
        },
        healthCheck: null, // No health check for redirect
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await this.databaseService.db
        .insert(routeConfigs)
        .values(testRouteConfig);
      console.log("✅ Created test redirect route configuration");
      // Create Traefik configuration file record for test redirect
      const testTraefikConfigRecord = {
        id: randomUUID(),
        projectId: null, // Standalone config not linked to any project
        configName: "test-redirect-config",
        configContent: `# Test redirect configuration for test.localhost -> google.com
http:
  services:
    redirect-service:
      loadBalancer:
        servers:
          - url: "https://google.com"

  routers:
    test-redirect-router:
      rule: "Host(\`test.localhost\`)"
      service: "redirect-service"
      entryPoints:
        - "web"
      middlewares:
        - "test-redirect-middleware"

  middlewares:
    test-redirect-middleware:
      redirectRegex:
        regex: "^https?://test\\\\.localhost/(.*)"
        replacement: "https://google.com/$1"
        permanent: false`,
        configType: "dynamic",
        storageType: "standalone" as const,
        requiresFile: true,
        syncStatus: "pending" as const,
        lastSyncedAt: null,
        syncErrorMessage: null,
        fileChecksum: null,
        configVersion: 1,
        metadata: {
          purpose: "test-redirect",
          target: "google.com",
        },
        description:
          "Test redirect configuration for test.localhost → google.com",
        tags: ["redirect", "test"],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const insertedTestTraefikConfigs = await this.databaseService.db
        .insert(traefikConfigs)
        .values(testTraefikConfigRecord)
        .returning();
      console.log("✅ Created test Traefik configuration record");
      // Create configuration file record for test redirect
      const testConfigFileRecord = {
        id: randomUUID(),
        traefikConfigId: insertedTestTraefikConfigs[0].id,
        filePath: "test-redirect.yml",
        fileSize: Buffer.byteLength(
          testTraefikConfigRecord.configContent,
          "utf8"
        ),
        checksum: null, // Will be calculated when file is written
        permissions: "644",
        owner: "traefik",
        exists: false,
        isWritable: true,
        lastWriteAttempt: null,
        writeErrorMessage: null,
        containerPath: "/etc/traefik/dynamic/test-redirect.yml",
        mountPoint: "./traefik-configs:/etc/traefik/dynamic",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await this.databaseService.db
        .insert(configFiles)
        .values(testConfigFileRecord);
      console.log("✅ Created test configuration file record");
      console.log("\n🎉 Database seeded successfully with:");
      console.log("  👥 2 sample users");
      console.log("  🏗️  2 sample projects");
      console.log(
        "  🌍 3 sample environments (production, staging, development)"
      );
      console.log(
        "  ⚙️  3 sample services with automatic Traefik configuration"
      );
      console.log("  🚀 2 sample deployments (API + Static)");
      console.log("  📋 10 deployment logs (6 API + 4 static)");
      console.log("  🔮 1 preview environment");
      console.log("  🔀 1 Traefik instance");
      console.log(
        "  🌐 4 domain configurations (3 services + 1 test redirect)"
      );
      console.log(
        "  🛣️  4 route configurations (3 services + 1 test redirect)"
      );
      console.log("  🤝 1 collaboration");
      console.log("  📁 4 Traefik config files (3 services + 1 test)");
      console.log("  📄 Service-specific config file records");
      console.log("\n🔧 Service-based Traefik Architecture:");
      console.log("  📊 2 service-based Traefik configurations (API + Web)");
      console.log("  🛣️  2 domain routes for service configs");
      console.log("  🎯 2 service targets for load balancing");
      console.log("  🔧 4 reusable middleware definitions");
      console.log("  📁 2 service-based config files");
      console.log("\n🧪 Service Domains Created:");
      console.log("  🌐 api.my-blog.localhost → API service");
      console.log("  🌐 web.my-blog.localhost → Web service");
      console.log("  🌐 static-demo-my-blog.localhost → Static demo service");
      console.log("  🎯 test.localhost → google.com redirect");
      console.log("\n✨ Traefik Integration Features:");
      console.log("  🔄 Automatic Traefik configuration per service");
      console.log("  🌍 DNS validation for localhost domains");
      console.log("  📊 Config file sync handling");
      console.log("  🚦 CORS and rate limiting middleware");
      console.log("  💉 Health check configuration");
      console.log("\n🔧 To test:");
      console.log("  1. Start services: bun run dev");
      console.log(
        "  2. Add to /etc/hosts: 127.0.0.1 api.my-blog.localhost web.my-blog.localhost static-demo-my-blog.localhost test.localhost"
      );
      console.log(
        "  3. Visit: http://test.localhost (should redirect to Google)"
      );
      console.log("  4. Visit: http://api.my-blog.localhost (API service)");
      console.log("  5. Visit: http://web.my-blog.localhost (Web service)");
      console.log(
        "  6. Visit: http://static-demo.my-blog.localhost (Static demo service - should work immediately)"
      );

      // ============================================================================
      // ADVANCED TRAEFIK CONFIGURATIONS
      // ============================================================================
      console.log("\n🗂️ Creating Advanced Traefik Configurations...");

      // Static Configuration for projects
      const staticConfig = {
        id: randomUUID(),
        projectId: insertedProjects[0].id,
        // Core configuration sections
        globalConfig: {
          checkNewVersion: false,
          sendAnonymousUsage: false,
        },
        apiConfig: {
          dashboard: true,
          insecure: true,
          debug: true,
        },
        entryPointsConfig: {
          web: {
            address: ":80",
            http: {
              redirections: {
                entrypoint: {
                  to: "websecure",
                  scheme: "https",
                },
              },
            },
          },
          websecure: {
            address: ":443",
          },
        },
        providersConfig: {
          file: {
            directory: "/etc/traefik/dynamic",
            watch: true,
          },
          docker: {
            endpoint: "unix:///var/run/docker.sock",
            exposedByDefault: false,
            watch: true,
          },
        },
        // Logging
        logConfig: {
          level: "INFO",
          format: "json",
        },
        accessLogConfig: {
          format: "json",
        },
        // Observability - set nullable fields to null
        metricsConfig: null,
        tracingConfig: null,
        // Security and TLS
        tlsConfig: null,
        certificateResolversConfig: {
          letsencrypt: {
            acme: {
              email: "admin@example.com",
              storage: "/data/acme.json",
              httpChallenge: {
                entryPoint: "web",
              },
            },
          },
        },
        // Advanced features - set nullable fields to null
        experimentalConfig: null,
        serversTransportConfig: null,
        hostResolverConfig: null,
        clusterConfig: null,
        // Full configuration cache
        fullConfig: null,
        configVersion: 1,
        // File sync status
        syncStatus: "pending",
        lastSyncedAt: null,
        syncErrorMessage: null,
        // Validation
        isValid: true,
        validationErrors: null,
      };

      await this.databaseService.db
        .insert(traefikStaticConfigs)
        .values(staticConfig);
      console.log(
        `✅ Created static configuration for project: ${insertedProjects[0].name}`
      );

      // Enhanced middleware configurations using proper types
      const middlewareConfigs: CreateTraefikMiddleware[] = [
        {
          id: randomUUID(),
          projectId: insertedProjects[0].id,
          middlewareName: "cors-development",
          middlewareType: "headers",
          configuration: {
            customRequestHeaders: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
              "Access-Control-Allow-Headers":
                "Content-Type,Authorization,X-Requested-With",
            },
            customResponseHeaders: {
              "Access-Control-Expose-Headers": "Content-Length,X-Kuma-Revision",
              "Access-Control-Max-Age": "86400",
            },
          },
          isGlobal: true,
          priority: 100,
          isActive: true,
          filePath: "/middleware/cors-development.yml",
        },
        {
          id: randomUUID(),
          projectId: insertedProjects[0].id,
          middlewareName: "security-headers",
          middlewareType: "headers",
          configuration: {
            customRequestHeaders: {},
            customResponseHeaders: {
              "X-Frame-Options": "SAMEORIGIN",
              "X-Content-Type-Options": "nosniff",
              "X-XSS-Protection": "1; mode=block",
              "Referrer-Policy": "strict-origin-when-cross-origin",
              "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
            },
            contentSecurityPolicy:
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
            customFrameOptionsValue: "SAMEORIGIN",
            contentTypeNosniff: true,
            browserXssFilter: true,
            forceSTSHeader: false,
            stsIncludeSubdomains: true,
            stsPreload: true,
            stsSeconds: 31536000,
          },
          isGlobal: false,
          priority: 80,
          isActive: true,
          filePath: "/middleware/security-headers.yml",
        },
        {
          projectId: insertedProjects[0].id,
          middlewareName: "compress-response",
          middlewareType: "compress",
          configuration: {
            excludedContentTypes: ["text/event-stream"],
            minResponseBodyBytes: 1024,
          },
          isGlobal: true,
          priority: 70,
          isActive: true,
          filePath: "/middleware/compress-response.yml",
        },
      ];

      const insertedMiddleware = await this.databaseService.db
        .insert(traefikMiddleware)
        .values(middlewareConfigs)
        .returning();
      console.log(
        `✅ Created ${insertedMiddleware.length} middleware configurations for virtual filesystem`
      );

      // Plugin configurations for virtual filesystem
      const pluginConfigs: CreateTraefikPlugin[] = [
        {
          id: randomUUID(),
          projectId: insertedProjects[0].id,
          pluginName: "traefik-real-ip",
          pluginVersion: "v1.0.3",
          pluginSource: "https://github.com/soulbalz/traefik-real-ip",
          configuration: {
            realIPHeader: "X-Forwarded-For",
            excludedNetworks: ["127.0.0.1/32", "::1/128"],
            recursive: true,
          },
          isEnabled: true,
          filePath: "/plugins/traefik-real-ip.yml",
        },
        {
          id: randomUUID(),
          projectId: insertedProjects[0].id,
          pluginName: "traefik-geoblock",
          pluginVersion: "v0.2.1",
          pluginSource:
            "https://plugins.traefik.io/plugins/62926070108ecc83915d7758/geoblock",
          configuration: {
            allowedCountries: ["US", "CA", "GB", "FR", "DE"],
            blockedCountries: [],
            defaultAllow: true,
            logLocalRequests: false,
            api: "https://ipapi.co/{ip}/country_iso/",
          },
          isEnabled: false, // Disabled by default
          filePath: "/plugins/traefik-geoblock.yml",
        },
      ];

      const insertedPlugins = await this.databaseService.db
        .insert(traefikPlugins)
        .values(pluginConfigs)
        .returning();
      console.log(
        `✅ Created ${insertedPlugins.length} plugin configurations for virtual filesystem`
      );

      // Static files for virtual filesystem
      const staticFiles: CreateTraefikStaticFile[] = [
        {
          id: randomUUID(),
          projectId: insertedProjects[0].id,
          fileName: "traefik.yml",
          fileContent: `# Main Traefik Configuration
api:
  dashboard: true
  debug: true
  insecure: true

entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"

providers:
  file:
    directory: /etc/traefik/dynamic
    watch: true
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
    network: "traefik-network"

certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@my-blog.localhost
      storage: /etc/traefik/acme/acme.json
      httpChallenge:
        entryPoint: web

log:
  level: INFO
  filePath: "/var/log/traefik/traefik.log"

accessLog:
  filePath: "/var/log/traefik/access.log"
  bufferingSize: 100

metrics:
  prometheus:
    addEntryPointsLabels: true
    addServicesLabels: true`,
          mimeType: "application/yaml",
          fileSize: 750,
          relativePath: "/traefik.yml",
          isPublic: false,
        },
        {
          id: randomUUID(),
          projectId: insertedProjects[0].id,
          fileName: "dynamic-config.yml",
          fileContent: `# Dynamic Configuration Template
http:
  middlewares:
    default-headers:
      headers:
        customRequestHeaders:
          X-Forwarded-Proto: "https"
        customResponseHeaders:
          X-Frame-Options: "SAMEORIGIN"
          X-Content-Type-Options: "nosniff"
    
    secure-headers:
      headers:
        accessControlAllowMethods:
          - GET
          - OPTIONS
          - PUT
        accessControlAllowOriginList:
          - origin-list-or-null
        accessControlMaxAge: 100
        addVaryHeader: true

  routers:
    api:
      rule: "Host(\`api.my-blog.localhost\`)"
      service: api
      middlewares:
        - default-headers

  services:
    api:
      loadBalancer:
        servers:
          - url: "http://api:3001"`,
          mimeType: "application/yaml",
          fileSize: 680,
          relativePath: "/dynamic/dynamic-config.yml",
          isPublic: false,
        },
        {
          projectId: insertedProjects[0].id,
          fileName: "docker-compose.override.yml",
          fileContent: `# Docker Compose Traefik Override
version: '3.8'

services:
  traefik:
    image: traefik:v3.0
    container_name: traefik-proxy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./traefik.yml:/etc/traefik/traefik.yml:ro
      - ./dynamic:/etc/traefik/dynamic:ro
      - ./ssl:/etc/traefik/ssl:ro
      - traefik-ssl-certs:/etc/traefik/acme
      - traefik-logs:/var/log/traefik
    networks:
      - traefik-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.traefik.rule=Host(\`traefik.my-blog.localhost\`)"
      - "traefik.http.routers.traefik.service=api@internal"

volumes:
  traefik-ssl-certs:
  traefik-logs:

networks:
  traefik-network:
    external: true`,
          mimeType: "application/yaml",
          fileSize: 820,
          relativePath: "/docker-compose.override.yml",
          isPublic: false,
        },
      ];

      const insertedStaticFiles = await this.databaseService.db
        .insert(traefikStaticFiles)
        .values(staticFiles)
        .returning();
      console.log(
        `✅ Created ${insertedStaticFiles.length} static files for virtual filesystem`
      );

      // Backup configurations for virtual filesystem
      const backupConfigs = [
        {
          id: randomUUID(),
          projectId: insertedProjects[0].id,
          backupName: "traefik-config-backup",
          backupType: "config",
          originalPath: "/etc/traefik/traefik.yml",
          backupContent: `# Backup of main Traefik configuration - ${new Date().toISOString()}
# This is a backup of the main traefik.yml configuration file

api:
  dashboard: true
  debug: false
  insecure: false

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"

providers:
  file:
    directory: /etc/traefik/dynamic
    watch: true

# Original backup content preserved`,
          compressionType: "none",
          backupSize: 455,
          metadata: {
            originalSize: 455,
            backupReason: "Pre-update backup",
            userAgent: "Traefik-Backup-Service/1.0",
          },
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        },
        {
          id: randomUUID(),
          projectId: insertedProjects[0].id,
          backupName: "ssl-certificates-backup",
          backupType: "ssl",
          originalPath: "/etc/traefik/ssl/",
          backupContent: `# SSL Certificates Backup Archive - ${new Date().toISOString()}
# Compressed archive of all SSL certificates

[GZIPPED_CERTIFICATE_ARCHIVE_CONTENT]
# This would contain the actual gzipped certificate files in production
# blog-localhost.crt, blog-localhost.key, wildcard-localhost.crt, etc.`,
          compressionType: "gzip",
          backupSize: 2048,
          metadata: {
            originalSize: 5120,
            compressionRatio: 0.4,
            certificateCount: 2,
            backupReason: "Weekly SSL backup",
          },
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
        },
        {
          id: randomUUID(),
          projectId: insertedProjects[0].id,
          backupName: "middleware-backup",
          backupType: "middleware",
          originalPath: "/etc/traefik/middleware/",
          backupContent: `# Middleware Configuration Backup - ${new Date().toISOString()}
# Full backup of all middleware configurations

cors-default.yml:
accessControlAllowOrigin: 
  - "http://localhost:3000"
  - "http://*.localhost"

rate-limiter.yml:
average: 100
period: "1m"
burst: 200

security-headers.yml:
customResponseHeaders:
  X-Frame-Options: "SAMEORIGIN"
  X-Content-Type-Options: "nosniff"`,
          compressionType: "none",
          backupSize: 512,
          metadata: {
            originalSize: 512,
            middlewareCount: 4,
            backupReason: "Pre-deployment backup",
          },
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        },
      ];

      const insertedBackups = await this.databaseService.db
        .insert(traefikBackups)
        .values(backupConfigs)
        .returning();
      console.log(
        `✅ Created ${insertedBackups.length} backup configurations for virtual filesystem`
      );

      console.log("\n🗂️  Virtual Filesystem Summary:");
      console.log(`  🔐 SSL certificate configurations created`);
      console.log(
        `  ⚙️  ${insertedMiddleware.length} middleware configurations (CORS, rate limiting, security, compression)`
      );
      console.log(
        `  🔌 ${insertedPlugins.length} plugin configurations (real-ip, geoblock)`
      );
      console.log(
        `  📄 ${insertedStaticFiles.length} static configuration files (traefik.yml, dynamic configs, docker-compose)`
      );
      console.log(
        `  💾 ${insertedBackups.length} backup configurations (config, SSL, middleware backups)`
      );
      console.log("\n✨ Virtual Filesystem Features:");
      console.log(
        "  📁 Complete virtual directory structure (dynamic, static, ssl, middleware, backups)"
      );
      console.log("  🔄 Database-driven file content management");
      console.log("  🏷️  File metadata tracking (MIME types, sizes, paths)");
      console.log("  🔐 SSL certificate lifecycle management");
      console.log("  🛡️  Security middleware with comprehensive headers");
      console.log("  💾 Automated backup system with expiration");

      // Mark database as seeded
      const seedMetadata = {
        usersCount: insertedUsers.length,
        projectsCount: insertedProjects.length,
        servicesCount: insertedServices.length + insertedStaticService.length,
        deploymentsCount: 0, // Deployments should be created by API, not seeded
        localServicesCreated: [insertedStaticService[0].name],
        serviceBasedTraefikConfigs: insertedServiceConfigs.length,
        middlewareDefinitions: middlewareDefinitions.length,
        serviceTargets: 2,
        domainRoutes: 2,
        configFiles: 2,
        // Virtual filesystem data
        virtualSslCertificates: 1,
        virtualMiddleware: insertedMiddleware.length,
        virtualPlugins: insertedPlugins.length,
        virtualStaticFiles: insertedStaticFiles.length,
        virtualBackups: insertedBackups.length,
      };
      await this.databaseService.db.insert(systemStatus).values({
        id: "system",
        isSeeded: true,
        seedVersion: "2.0.0", // Updated to include virtual filesystem data
        lastSeededAt: new Date(),
        seedMetadata: seedMetadata,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(
        "✅ Database marked as seeded - future seeding runs will be skipped"
      );
    } catch (error) {
      console.error("❌ Seeding failed:", error);
      process.exit(1);
    }

    console.log(
      "✅ Database seeded successfully with role-based users and API keys"
    );
  }
}
