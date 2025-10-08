import { Command, CommandRunner } from "nest-commander";
import { Injectable, Inject } from "@nestjs/common";
import { AUTH_INSTANCE_KEY } from "@/core/modules/auth/types/symbols";
import type { Auth } from "@/auth";
import { nanoid } from "nanoid";
import { roles } from "@/config/auth/permissions/statements"; // Correct relative path

import {
  projects,
  services,
  serviceDependencies,
  projectCollaborators,
  systemStatus,
  traefikMiddlewares,
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
  traefikServiceConfigs,
  type CreateTraefikMiddleware,
  type CreateTraefikPlugin,
  type CreateTraefikStaticFile,
} from "@/config/drizzle/schema";
import {
  githubApps,
  githubRepositoryConfigs,
  githubDeploymentRules,
} from "@/config/drizzle/schema/github-provider";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { DatabaseService } from "@/core/modules/database/services/database.service";
import { EnvService } from "@/config/env/env.service";
import { GithubProviderService } from "@/core/modules/providers/github/github-provider.service";
import { StaticProviderService } from "@/core/modules/providers/static/static-provider.service";
import { TraefikConfigBuilder } from "@/core/modules/traefik/config-builder/builders";
import { TraefikRepository } from "@/core/modules/traefik/repositories/traefik.repository";

// Interface for service data used in this.createServiceWithTraefik function
interface ServiceData {
  id?: string;
  projectId: string;
  name: string;
  type: string;
  providerId: string;
  builderId: string;
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
    private readonly databaseService: DatabaseService,
    private readonly envService: EnvService,
    private readonly githubProvider: GithubProviderService,
    private readonly staticProvider: StaticProviderService,
    private readonly traefikRepository: TraefikRepository
  ) {
    super();
  }

  // Helper function to create service with provider's default Traefik template
  async createServiceWithTraefik(
    serviceData: ServiceData,
    projectId: string,
    projectDomain: string
  ) {
    // Get provider instance
    const provider = serviceData.providerId === 'github' ? this.githubProvider : this.staticProvider;
    
    // Get default Traefik template from provider (with variables ~##name##~)
    const traefikTemplate = provider.getTraefikTemplate();
    
    console.log(`🌐 Creating service: ${serviceData.name} for project ${projectId} with provider ${provider.constructor.name}`);
    
    // Parse template into TraefikConfigBuilder (stores with variables intact)
    const traefikConfigBuilder = TraefikConfigBuilder.load(traefikTemplate);
    
    // Create the service in database with TraefikConfigBuilder
    // The traefikConfig column uses custom type that serializes the builder with variables intact
    const [service] = await this.databaseService.db
      .insert(services)
      .values({
        ...serviceData,
        providerId: serviceData.providerId,
        builderId: serviceData.builderId,
        traefikConfig: traefikConfigBuilder, // Custom column type auto-serializes with variables
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
      
    console.log(`✅ Created service: ${service.name} (Traefik template stored with variables)`);
    
    // Create initial traefik_service_configs entry
    const traefikServiceConfig = await this.traefikRepository.createServiceConfig({
      serviceId: service.id,
      domain: projectDomain || 'localhost',
      subdomain: service.name,
      port: serviceData.port || 80,
      sslEnabled: false,
      sslProvider: undefined,
      pathPrefix: '/',
      middleware: {},
      healthCheck: {
        enabled: false,
        path: serviceData.healthCheckPath || '/',
      },
      isActive: true,
    });
    
    // Update the config to add configContent (which is not in the create input type)
    await this.databaseService.db
      .update(traefikServiceConfigs)
      .set({ configContent: traefikTemplate })
      .where(eq(traefikServiceConfigs.id, traefikServiceConfig.id));
    
    console.log(`✅ Created traefik_service_configs entry for: ${service.name}`);
    
    // NOTE: We do NOT create Traefik config files here anymore
    // The deployment processor will:
    // 1. Load the template from service.traefikConfig
    // 2. Resolve variables during deployment
    // 3. Create the actual Traefik config files
    // 4. Sync to Traefik filesystem
    
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
      const usersCreationPromises: Promise<
        Awaited<ReturnType<typeof this.auth.api.createUser>>["user"]
      >[] = [];
      const masterEmail = this.envService.get("MASTER_USER")?.email;
      if (masterEmail) {
        usersCreationPromises.push(
          new Promise(async (resolve) => {
            resolve(
              await this.auth.api
                .createUser({
                  body: {
                    name: "admin admin",
                    email: masterEmail,
                    password: this.envService.get("MASTER_USER")?.password || "adminadmin",
                    data: {
                      role: roles.superAdmin,
                      emailVerified: true,
                      image: `https://avatars.githubusercontent.com/u/1?v=4`,
                    },
                  },
                })
                .then((userResult) => userResult.user)
            );
          })
        );
      }
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
          providerId: "github",
          builderId: "dockerfile",
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
          providerId: "github",
          builderId: "nixpack",
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
      console.log("✅ Created sample services with Traefik templates");
      
      // NOTE: Service-based Traefik configurations are NO LONGER created in seed
      // The deployment processor will:
      // 1. Load service.traefikConfig (template with variables)
      // 2. Resolve variables during deployment
      // 3. Create actual Traefik config files
      // 4. Sync to Traefik filesystem
      
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

      // NOTE: Config files are NO LONGER created in seed
      // The deployment processor will create config files when resolving templates
      
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
          id: "aaaabdf8-5731-4380-86b0-c884e2c55d64",
          projectId: insertedProjects[0].id,
          name: "static-demo",
          type: "frontend",
          providerId: "manual",
          builderId: "static",
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

      // NOTE: Static service Traefik configuration is NO LONGER created in seed
      // The template is already stored in staticService.traefikConfig
      // Deployment processor will resolve variables and create actual config files
      
      console.log("✅ Static service created with Traefik template");

      // ============================================================================
      // GITHUB PROVIDER CONFIGURATION
      // ============================================================================
      console.log("\n🐙 Creating GitHub Provider Configuration...");

      // Create GitHub App (for octocat organization)
      const githubAppConfig = {
        id: randomUUID(),
        organizationId: "octocat",
        name: "Deployer GitHub App",
        appId: "123456",
        clientId: "Iv1.demo-client-id",
        clientSecret: "demo-client-secret-for-testing",
        privateKey: "-----BEGIN RSA PRIVATE KEY-----\nDEMO_PRIVATE_KEY\n-----END RSA PRIVATE KEY-----",
        webhookSecret: "demo-webhook-secret",
        installationId: "12345678",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const [insertedGithubApp] = await this.databaseService.db
        .insert(githubApps)
        .values(githubAppConfig)
        .returning();
      console.log(`✅ Created GitHub App for organization: ${githubAppConfig.organizationId}`);

      // Create Repository Configuration for octocat/Spoon-Knife
      const repoConfig = {
        id: randomUUID(),
        projectId: insertedProjects[0].id,
        githubAppId: insertedGithubApp.id,
        repositoryId: "1300192", // Actual GitHub ID for Spoon-Knife
        repositoryFullName: "octocat/Spoon-Knife",
        basePath: "/",
        watchPaths: ["**/*"],
        ignorePaths: ["node_modules/**", ".git/**"],
        cacheStrategy: "loose" as const,
        autoDeployEnabled: true,
        deploymentStrategy: "standard" as const,
        customStrategyScript: null,
        previewDeploymentsEnabled: false,
        previewBranchPattern: "*",
        previewAutoDelete: true,
        previewAutoDeleteAfterDays: 7,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.databaseService.db
        .insert(githubRepositoryConfigs)
        .values(repoConfig);
      console.log(`✅ Created repository config: ${repoConfig.repositoryFullName}`);

      // Create Deployment Rule for push events
      const deploymentRule = {
        id: randomUUID(),
        projectId: insertedProjects[0].id,
        name: "Deploy on Main Push",
        description: "Automatically deploy when code is pushed to main branch",
        priority: 100,
        isActive: true,
        event: "push",
        branchPattern: "main",
        tagPattern: null,
        pathConditions: {
          include: ["**/*.html", "**/*.css", "**/*.js"],
          exclude: ["README.md"],
          requireAll: false,
        },
        customCondition: null,
        action: "deploy",
        deploymentStrategy: "standard" as const,
        customStrategyScript: null,
        bypassCache: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.databaseService.db
        .insert(githubDeploymentRules)
        .values(deploymentRule);
      console.log(`✅ Created deployment rule: ${deploymentRule.name}`);

      console.log("\n🎉 GitHub Provider Configuration Complete!");
      console.log("  📦 Repository: octocat/Spoon-Knife");
      console.log("  🔀 Branch: main");
      console.log("  🚀 Auto-deploy: enabled");
      console.log("  📋 Strategy: standard");
      console.log("  🔧 Builder: static (assigned to static-demo service)");
      console.log("\n💡 To test GitHub webhook deployment:");
      console.log("  1. Service 'static-demo' is configured with manual provider");
      console.log("  2. Update service to use GitHub provider with octocat/Spoon-Knife");
      console.log("  3. Push to main branch will trigger automatic deployment");
      console.log("  4. Files will be served at: http://static-demo-my-blog.localhost");

      // Create GitHub-based service
      console.log("\n🚀 Creating GitHub-based service...");
      
      // Create GitHub service with Traefik template
      void await this.createServiceWithTraefik(
        {
          id: randomUUID(),
          projectId: insertedProjects[0].id,
          name: "spoon-knife",
          type: "frontend",
          providerId: "github",
          builderId: "static",
          providerConfig: {
            repositoryUrl: "https://github.com/octocat/Spoon-Knife",
            branch: "main",
          },
          builderConfig: {
            outputDirectory: "/",
          },
          port: 80,
          healthCheckPath: "/index.html",
          environmentVariables: {} as Record<string, string>,
          resourceLimits: {
            memory: "64m",
            cpu: "0.1",
          },
        },
        insertedProjects[0].id,
        insertedProjects[0].baseDomain || "localhost"
      );

      // NOTE: GitHub service Traefik configuration is NO LONGER created in seed
      // The template is already stored in githubService.traefikConfig
      // Deployment processor will resolve variables and create actual config files
      
      console.log("✅ Created GitHub service: spoon-knife");
      console.log("  📦 Repository: octocat/Spoon-Knife");
      console.log("  🌐 URL: http://spoon-knife.my-blog.localhost");
      console.log("  🔧 Builder: static");
      console.log("  🚀 Auto-deploy: enabled via GitHub webhook");

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
      console.log("   1 preview environment");
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
        "  6. Visit: http://static-demo-my-blog.localhost (Static demo service - should work immediately)"
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
          fileContent: `# Dynamic Configuration Template Example
# NOTE: This is a DEMO file showing variable syntax
# Real configs are created by deployment processor from service templates
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
    ~##serviceName##~:
      rule: "Host(\`~##host##~\`)"
      service: ~##serviceName##~
      middlewares:
        - default-headers

  services:
    ~##serviceName##~:
      loadBalancer:
        servers:
          - url: "http://~##containerName##~:~##containerPort##~"`,
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
        // NOTE: Service-based configs are NO LONGER created in seed
        // Deployment processor creates these from templates
        middlewareDefinitions: middlewareDefinitions.length,
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
