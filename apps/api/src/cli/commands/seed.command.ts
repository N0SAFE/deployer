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
import { githubApps, githubRepositoryConfigs, githubDeploymentRules } from "@/config/drizzle/schema/github-provider";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { DatabaseService } from "@/core/modules/database/services/database.service";
import { EnvService } from "@/config/env/env.service";
import { GithubProviderService } from "@/core/modules/providers/github/github-provider.service";
import { StaticProviderService } from "@/core/modules/providers/static/static-provider.service";
import { TraefikConfigBuilder } from "@/core/modules/traefik/config-builder/builders";
import { TraefikRepository } from "@/core/modules/traefik/repositories/traefik.repository";
import type { UserWithRole } from "better-auth/plugins";
import { SeedBuilder } from "./seed.builder";

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
    async createServiceWithTraefik(serviceData: ServiceData, projectId: string, projectDomain: string) {
        // Get provider instance
        const provider = serviceData.providerId === "github" ? this.githubProvider : this.staticProvider;

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
            domain: projectDomain || "localhost",
            subdomain: service.name,
            port: serviceData.port || 80,
            sslEnabled: false,
            sslProvider: undefined,
            pathPrefix: "/",
            middleware: {},
            healthCheck: {
                enabled: false,
                path: serviceData.healthCheckPath || "/",
            },
            isActive: true,
        });

        // Update the config to add configContent (which is not in the create input type)
        await this.databaseService.db.update(traefikServiceConfigs).set({ configContent: traefikTemplate }).where(eq(traefikServiceConfigs.id, traefikServiceConfig.id));

        console.log(`✅ Created traefik_service_configs entry for: ${service.name}`);

        // NOTE: We do NOT create Traefik config files here anymore
        // The deployment processor will:
        // 1. Load the template from service.traefikConfig
        // 2. Resolve variables during deployment
        // 3. Create the actual Traefik config files
        // 4. Sync to Traefik filesystem

        return service;
    }

    /**
     * Create users with roles
     * @param _ctx - Empty context (unused in first step)
     * @returns Context with insertedUsers, masterUser, and masterUserHeaders
     */
    private async createUsers(ctx: { finalLogs: string[] }) {
        // Dynamically get roles from permissions
        const roleNames = Object.keys(roles) as (keyof typeof roles)[];
        const usersPerRole = 2;
        
        const usersCreationPromises: Promise<Awaited<ReturnType<typeof this.auth.api.createUser>>["user"]>[] = [];
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
                        resolve(userResult.user);
                    })
                );
            }
        }
        
        const insertedUsers = await Promise.all(usersCreationPromises);
        console.log(`✅ Created ${insertedUsers.length} sample users`);

        const masterUser = insertedUsers.find((u) => u.email === masterEmail) || insertedUsers[0];
        console.log(`👑 Master user: ${masterUser.email} (ID: ${masterUser.id})`);
        
        const apiKey = await this.auth.api.createApiKey({
            body: {
                userId: masterUser.id,
            },
        });

        const masterUserHeaders = { 
            Authorization: `Bearer ${apiKey.key}`, 
            "x-api-key": apiKey.key 
        };

        ctx.finalLogs.push(`👥 Created ${insertedUsers.length} users`);
        ctx.finalLogs.push(`   👑 Master: ${masterUser.email}`);

        return {
            ...ctx,
            insertedUsers,
            masterUser,
            masterUserHeaders,
            masterEmail,
        };
    }

    /**
     * Create shared organization and add all users as members
     * @param ctx - Context with insertedUsers, masterUser, masterUserHeaders, masterEmail
     * @returns Context spread with sharedOrg added
     */
    private async createOrganization(ctx: {
        finalLogs: string[];
        insertedUsers: UserWithRole[];
        masterUser: UserWithRole;
        masterUserHeaders: { Authorization: string; "x-api-key": string };
        masterEmail: string | undefined;
    }) {
        console.log("🏢 Creating shared organization for all users...");
        
        const sharedOrg = await this.auth.api.createOrganization({
            body: {
                name: "Default Organization",
                slug: "default-organization",
                metadata: {
                    createdBy: ctx.masterUser.id,
                    isDefault: true,
                    isShared: true,
                },
            },
            headers: ctx.masterUserHeaders,
        });

        if (!sharedOrg || !sharedOrg.id) {
            throw new Error("Failed to create shared organization");
        }

        console.log(`✅ Created shared organization: "${sharedOrg.name}"`);

        // Filter out master user and add all others as members
        const insertedUsersWithoutMaster = ctx.insertedUsers.filter((u) => u.email !== ctx.masterEmail);
        
        // Add all users as members of the shared organization
        const memberOrganizationPromises = insertedUsersWithoutMaster.map(async (user, index) => {
            const role = ctx.masterEmail === user.email ? "owner" : index === 0 ? "owner" : "member";

            return this.auth.api.addMember({
                body: {
                    organizationId: sharedOrg.id,
                    userId: user.id,
                    role: role,
                },
            });
        });

        await Promise.all(memberOrganizationPromises);
        console.log("✅ Created sample users with shared organization");

        ctx.finalLogs.push(`🏢 Shared organization: "${sharedOrg.name}" (${insertedUsersWithoutMaster.length + 1} members)`);

        return {
            ...ctx,
            sharedOrg,
        };
    }

    /**
     * Create sample projects
     * @param ctx - Context with insertedUsers and masterUser
     * @returns Context spread with insertedProjects added
     */
    private async createProjects(ctx: {
        finalLogs: string[];
        insertedUsers: UserWithRole[];
        masterUser: UserWithRole;
        masterUserHeaders: { Authorization: string; "x-api-key": string };
        masterEmail: string | undefined;
        sharedOrg: Awaited<ReturnType<Auth['api']['createOrganization']>>;
    }) {
        const sampleProjects = [
            {
                id: "27c3ad1e-d5d7-4afb-9e8b-27646a387268",
                name: "My Blog",
                description: "Personal blog with Next.js frontend and NestJS API",
                baseDomain: "my-blog.localhost",
                ownerId: ctx.masterUser.id,
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
                description: "Online store with React frontend, Node.js API, and PostgreSQL",
                baseDomain: "shop.localhost",
                ownerId: ctx.insertedUsers[1].id,
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

        return {
            ...ctx,
            insertedProjects,
        };
    }

    /**
     * Create sample environments for projects
     * @param ctx - Context with insertedProjects and masterUser
     * @returns Context spread with insertedEnvironments added
     */
    private async createEnvironments(ctx: {
        finalLogs: string[];
        insertedUsers: UserWithRole[];
        masterUser: UserWithRole;
        masterUserHeaders: { Authorization: string; "x-api-key": string };
        masterEmail: string | undefined;
        sharedOrg: Awaited<ReturnType<Auth['api']['createOrganization']>>;
        insertedProjects: typeof projects.$inferSelect[];
    }) {
        console.log("🌍 Creating sample environments...");
        
        const sampleEnvironments = [
            {
                name: "Production",
                slug: "production",
                description: "Production environment for live applications",
                type: "production" as const,
                status: "healthy" as const,
                projectId: ctx.insertedProjects[0].id,
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
                createdBy: ctx.masterUser.id,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                name: "Staging",
                slug: "staging",
                description: "Staging environment for testing",
                type: "staging" as const,
                status: "healthy" as const,
                projectId: ctx.insertedProjects[0].id,
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
                createdBy: ctx.masterUser.id,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                name: "Development",
                slug: "development",
                description: "Development environment for local testing",
                type: "development" as const,
                status: "healthy" as const,
                projectId: ctx.insertedProjects[1].id,
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
                createdBy: ctx.masterUser.id,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ];

        const insertedEnvironments = await this.databaseService.db
            .insert(environments)
            .values(sampleEnvironments)
            .returning();
        
        console.log("✅ Created sample environments");
        console.log("📋 Environments created:", insertedEnvironments.map((env) => `${env.name} (${env.slug})`).join(", "));

        return {
            ...ctx,
            insertedEnvironments,
        };
    }

    /**
     * Create sample services with Traefik configuration
     * @param ctx - Context with insertedProjects
     * @returns Context spread with insertedServices and insertedStaticService added
     */
    private async createServices(ctx: {
        finalLogs: string[];
        insertedUsers: UserWithRole[];
        masterUser: UserWithRole;
        masterUserHeaders: { Authorization: string; "x-api-key": string };
        masterEmail: string | undefined;
        sharedOrg: Awaited<ReturnType<Auth['api']['createOrganization']>>;
        insertedProjects: typeof projects.$inferSelect[];
        insertedEnvironments: typeof environments.$inferSelect[];
    }) {
        console.log("🚀 Creating services with Traefik configuration...");
        
        // API Service for blog project
        const apiService = await this.createServiceWithTraefik(
            {
                projectId: ctx.insertedProjects[0].id,
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
                    DATABASE_URL: "postgresql://user:pass@this.databaseService.db:5432/mydb",
                    REDIS_URL: "redis://redis:6379",
                } as Record<string, string>,
                resourceLimits: {
                    memory: "512m",
                    cpu: "0.5",
                },
            },
            ctx.insertedProjects[0].id,
            ctx.insertedProjects[0].baseDomain || "localhost"
        );
        
        // Web Service for blog project
        const webService = await this.createServiceWithTraefik(
            {
                projectId: ctx.insertedProjects[0].id,
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
            ctx.insertedProjects[0].id,
            ctx.insertedProjects[0].baseDomain || "localhost"
        );
        
        const insertedServices = [apiService, webService];
        console.log("✅ Created sample services with Traefik templates");

        // Create reusable middleware definitions
        const middlewareDefinitions = [
            {
                id: randomUUID(),
                name: "cors-api",
                type: "headers" as const,
                config: {
                    accessControlAllowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                    accessControlAllowOriginList: [
                        `http://${ctx.insertedProjects[0].baseDomain || "my-blog.localhost"}`,
                        "http://localhost:3000",
                    ],
                    accessControlAllowHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
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
                    excludedContentTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
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
                        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
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

        await this.databaseService.db.insert(traefikMiddlewares).values(middlewareDefinitions);
        console.log("✅ Created middleware definitions");

        // Create static file content
        const staticFileContent = this.getStaticFileContent();
        
        // Static Service for testing local file deployment
        const staticService = await this.createServiceWithTraefik(
            {
                id: "aaaabdf8-5731-4380-86b0-c884e2c55d64",
                projectId: ctx.insertedProjects[0].id,
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
            ctx.insertedProjects[0].id,
            ctx.insertedProjects[0].baseDomain || "localhost"
        );
        
        const insertedStaticService = [staticService];
        console.log("✅ Created static file service with Traefik configuration");

        // GitHub-based service
        console.log("\n🚀 Creating GitHub-based service...");
        const githubService = await this.createServiceWithTraefik(
            {
                id: randomUUID(),
                projectId: ctx.insertedProjects[0].id,
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
            ctx.insertedProjects[0].id,
            ctx.insertedProjects[0].baseDomain || "localhost"
        );
        console.log("✅ Created GitHub service: spoon-knife");

        const baseDomain = ctx.insertedProjects[0].baseDomain || "localhost";
        ctx.finalLogs.push(`\n🌐 Service URLs:`);
        ctx.finalLogs.push(`   🔹 API: http://api.${baseDomain}`);
        ctx.finalLogs.push(`   🔹 Web: http://web.${baseDomain}`);
        ctx.finalLogs.push(`   🔹 Static Demo: http://static-demo.${baseDomain}`);
        ctx.finalLogs.push(`   🔹 GitHub Service (spoon-knife): http://spoon-knife.${baseDomain}`);

        return {
            ...ctx,
            insertedServices,
            insertedStaticService,
            apiService,
            webService,
            githubService,
        };
    }

    /**
     * Get static file content for demo
     */
    private getStaticFileContent() {
        return {
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
    }

    /**
     * Create GitHub provider configuration
     * @param ctx - Context with insertedProjects
     * @returns Context spread with GitHub provider data
     */
    private async createGithubProvider(ctx: {
        finalLogs: string[];
        insertedUsers: UserWithRole[];
        masterUser: UserWithRole;
        masterUserHeaders: { Authorization: string; "x-api-key": string };
        masterEmail: string | undefined;
        sharedOrg: Awaited<ReturnType<Auth['api']['createOrganization']>>;
        insertedProjects: typeof projects.$inferSelect[];
        insertedEnvironments: typeof environments.$inferSelect[];
        insertedServices: typeof services.$inferSelect[];
        insertedStaticService: typeof services.$inferSelect[];
        apiService: typeof services.$inferSelect;
        webService: typeof services.$inferSelect;
        githubService: typeof services.$inferSelect;
    }) {
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
            projectId: ctx.insertedProjects[0].id,
            githubAppId: insertedGithubApp.id,
            repositoryId: "1300192",
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

        await this.databaseService.db.insert(githubRepositoryConfigs).values(repoConfig);
        console.log(`✅ Created repository config: ${repoConfig.repositoryFullName}`);

        // Create Deployment Rule for push events
        const deploymentRule = {
            id: randomUUID(),
            projectId: ctx.insertedProjects[0].id,
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

        await this.databaseService.db.insert(githubDeploymentRules).values(deploymentRule);
        console.log(`✅ Created deployment rule: ${deploymentRule.name}`);
        console.log("\n🎉 GitHub Provider Configuration Complete!");

        return {
            ...ctx,
            insertedGithubApp,
        };
    }

    /**
     * Create service dependencies
     * @param ctx - Context with services
     * @returns Context unchanged (dependencies are linking data)
     */
    private async createServiceDependencies(ctx: {
        finalLogs: string[];
        insertedUsers: UserWithRole[];
        masterUser: UserWithRole;
        masterUserHeaders: { Authorization: string; "x-api-key": string };
        masterEmail: string | undefined;
        sharedOrg: Awaited<ReturnType<Auth['api']['createOrganization']>>;
        insertedProjects: typeof projects.$inferSelect[];
        insertedEnvironments: typeof environments.$inferSelect[];
        insertedServices: typeof services.$inferSelect[];
        insertedStaticService: typeof services.$inferSelect[];
        apiService: typeof services.$inferSelect;
        webService: typeof services.$inferSelect;
        githubService: typeof services.$inferSelect;
        insertedGithubApp: typeof githubApps.$inferSelect;
    }) {
        // Create service dependency (web depends on api)
        const serviceDependency = {
            serviceId: ctx.webService.id,
            dependsOnServiceId: ctx.apiService.id,
            isRequired: true,
            createdAt: new Date(),
        };
        
        await this.databaseService.db
            .insert(serviceDependencies)
            .values(serviceDependency);
        
        console.log("✅ Created service dependencies");

        return ctx;
    }

    /**
     * Create project collaborations
     * @param ctx - Context with users and projects
     * @returns Context unchanged (collaborations are linking data)
     */
    private async createCollaborations(ctx: {
        finalLogs: string[];
        insertedUsers: UserWithRole[];
        masterUser: UserWithRole;
        masterUserHeaders: { Authorization: string; "x-api-key": string };
        masterEmail: string | undefined;
        sharedOrg: Awaited<ReturnType<Auth['api']['createOrganization']>>;
        insertedProjects: typeof projects.$inferSelect[];
        insertedEnvironments: typeof environments.$inferSelect[];
        insertedServices: typeof services.$inferSelect[];
        insertedStaticService: typeof services.$inferSelect[];
        apiService: typeof services.$inferSelect;
        webService: typeof services.$inferSelect;
        githubService: typeof services.$inferSelect;
        insertedGithubApp: typeof githubApps.$inferSelect;
    }) {
        // Add collaborator to first project
        const collaboration = {
            projectId: ctx.insertedProjects[0].id,
            userId: ctx.insertedUsers[1].id,
            role: "developer" as const,
            permissions: {
                canDeploy: true,
                canManageServices: false,
                canManageCollaborators: false,
                canViewLogs: true,
                canDeleteDeployments: false,
            },
            invitedBy: ctx.masterUser.id,
            invitedAt: new Date(),
            acceptedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        
        await this.databaseService.db
            .insert(projectCollaborators)
            .values(collaboration);
        
        console.log("✅ Created project collaborations");

        return ctx;
    }

    /**
     * Create advanced Traefik configurations
     * Includes: test redirect, static configs, middleware, plugins, static files, backups
     * @param ctx - Context with projects
     * @returns Context spread with Traefik configuration data
     */
    private async createAdvancedTraefikConfigurations(ctx: {
        finalLogs: string[];
        insertedUsers: UserWithRole[];
        masterUser: UserWithRole;
        masterUserHeaders: { Authorization: string; "x-api-key": string };
        masterEmail: string | undefined;
        sharedOrg: Awaited<ReturnType<Auth['api']['createOrganization']>>;
        insertedProjects: typeof projects.$inferSelect[];
        insertedEnvironments: typeof environments.$inferSelect[];
        insertedServices: typeof services.$inferSelect[];
        insertedStaticService: typeof services.$inferSelect[];
        apiService: typeof services.$inferSelect;
        webService: typeof services.$inferSelect;
        githubService: typeof services.$inferSelect;
        insertedGithubApp: typeof githubApps.$inferSelect;
    }) {
        // Create test Traefik configuration for test.localhost → google.com
        const testDomainConfig = {
            id: randomUUID(),
            projectId: ctx.insertedProjects[0].id,
            domain: "localhost",
            subdomain: "test",
            fullDomain: "test.localhost",
            sslEnabled: false,
            sslProvider: null,
            middleware: {
                redirectToHttps: false,
                cors: {
                    accessControlAllowOrigin: ["*"],
                    accessControlAllowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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

        // Create test route configuration
        const testRouteConfig = {
            id: randomUUID(),
            domainConfigId: insertedTestDomainConfigs[0].id,
            deploymentId: null,
            routeName: "test-redirect-route",
            serviceName: "redirect-to-google",
            containerName: null,
            targetPort: 80,
            pathPrefix: "/",
            priority: 1,
            middleware: {
                redirect: {
                    regex: "^https?://test\\.localhost/(.*)",
                    replacement: "https://google.com/$1",
                    permanent: false,
                },
            },
            healthCheck: null,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        
        await this.databaseService.db.insert(routeConfigs).values(testRouteConfig);
        console.log("✅ Created test redirect route configuration");

        // Create Traefik configuration file record for test redirect
        const testTraefikConfigRecord = {
            id: randomUUID(),
            projectId: null,
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
            description: "Test redirect configuration for test.localhost → google.com",
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
            fileSize: Buffer.byteLength(testTraefikConfigRecord.configContent, "utf8"),
            checksum: null,
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
        
        await this.databaseService.db.insert(configFiles).values(testConfigFileRecord);
        console.log("✅ Created test configuration file record");

        console.log("\n🗂️ Creating Advanced Traefik Configurations...");

        // Static Configuration for projects
        const staticConfig = {
            id: randomUUID(),
            projectId: ctx.insertedProjects[0].id,
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
            logConfig: {
                level: "INFO",
                format: "json",
            },
            accessLogConfig: {
                format: "json",
            },
            metricsConfig: null,
            tracingConfig: null,
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
            experimentalConfig: null,
            serversTransportConfig: null,
            hostResolverConfig: null,
            clusterConfig: null,
            fullConfig: null,
            configVersion: 1,
            syncStatus: "pending",
            lastSyncedAt: null,
            syncErrorMessage: null,
            isValid: true,
            validationErrors: null,
        };

        await this.databaseService.db.insert(traefikStaticConfigs).values(staticConfig);
        console.log(`✅ Created static configuration for project: ${ctx.insertedProjects[0].name}`);

        // Enhanced middleware configurations
        const middlewareConfigs: CreateTraefikMiddleware[] = [
            {
                id: randomUUID(),
                projectId: ctx.insertedProjects[0].id,
                middlewareName: "cors-development",
                middlewareType: "headers",
                configuration: {
                    customRequestHeaders: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
                        "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Requested-With",
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
                projectId: ctx.insertedProjects[0].id,
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
                    contentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
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
                projectId: ctx.insertedProjects[0].id,
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
        console.log(`✅ Created ${insertedMiddleware.length} middleware configurations`);

        // Plugin configurations
        const pluginConfigs: CreateTraefikPlugin[] = [
            {
                id: randomUUID(),
                projectId: ctx.insertedProjects[0].id,
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
                projectId: ctx.insertedProjects[0].id,
                pluginName: "traefik-geoblock",
                pluginVersion: "v0.2.1",
                pluginSource: "https://plugins.traefik.io/plugins/62926070108ecc83915d7758/geoblock",
                configuration: {
                    allowedCountries: ["US", "CA", "GB", "FR", "DE"],
                    blockedCountries: [],
                    defaultAllow: true,
                    logLocalRequests: false,
                    api: "https://ipapi.co/{ip}/country_iso/",
                },
                isEnabled: false,
                filePath: "/plugins/traefik-geoblock.yml",
            },
        ];

        const insertedPlugins = await this.databaseService.db
            .insert(traefikPlugins)
            .values(pluginConfigs)
            .returning();
        console.log(`✅ Created ${insertedPlugins.length} plugin configurations`);

        // Static files
        const staticFiles: CreateTraefikStaticFile[] = [
            {
                id: randomUUID(),
                projectId: ctx.insertedProjects[0].id,
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
                projectId: ctx.insertedProjects[0].id,
                fileName: "dynamic-config.yml",
                fileContent: `# Dynamic Configuration Template Example
http:
  middlewares:
    default-headers:
      headers:
        customRequestHeaders:
          X-Forwarded-Proto: "https"
        customResponseHeaders:
          X-Frame-Options: "SAMEORIGIN"
          X-Content-Type-Options: "nosniff"`,
                mimeType: "application/yaml",
                fileSize: 280,
                relativePath: "/dynamic/dynamic-config.yml",
                isPublic: false,
            },
            {
                projectId: ctx.insertedProjects[0].id,
                fileName: "docker-compose.override.yml",
                fileContent: `# Docker Compose Traefik Override
version: '3.8'

services:
  traefik:
    image: traefik:v3.0
    container_name: traefik-proxy
    restart: unless-stopped`,
                mimeType: "application/yaml",
                fileSize: 200,
                relativePath: "/docker-compose.override.yml",
                isPublic: false,
            },
        ];

        const insertedStaticFiles = await this.databaseService.db
            .insert(traefikStaticFiles)
            .values(staticFiles)
            .returning();
        console.log(`✅ Created ${insertedStaticFiles.length} static files`);

        // Backup configurations
        const backupConfigs = [
            {
                id: randomUUID(),
                projectId: ctx.insertedProjects[0].id,
                backupName: "traefik-config-backup",
                backupType: "config",
                originalPath: "/etc/traefik/traefik.yml",
                backupContent: `# Backup of main Traefik configuration - ${new Date().toISOString()}`,
                compressionType: "none",
                backupSize: 100,
                metadata: {
                    originalSize: 100,
                    backupReason: "Pre-update backup",
                },
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
            {
                id: randomUUID(),
                projectId: ctx.insertedProjects[0].id,
                backupName: "ssl-certificates-backup",
                backupType: "ssl",
                originalPath: "/etc/traefik/ssl/",
                backupContent: `# SSL Certificates Backup Archive - ${new Date().toISOString()}`,
                compressionType: "gzip",
                backupSize: 2048,
                metadata: {
                    originalSize: 5120,
                    compressionRatio: 0.4,
                },
                expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
            },
            {
                id: randomUUID(),
                projectId: ctx.insertedProjects[0].id,
                backupName: "middleware-backup",
                backupType: "middleware",
                originalPath: "/etc/traefik/middleware/",
                backupContent: `# Middleware Configuration Backup - ${new Date().toISOString()}`,
                compressionType: "none",
                backupSize: 512,
                metadata: {
                    originalSize: 512,
                },
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
        ];

        const insertedBackups = await this.databaseService.db
            .insert(traefikBackups)
            .values(backupConfigs)
            .returning();
        console.log(`✅ Created ${insertedBackups.length} backup configurations`);

        console.log("\n🗂️  Virtual Filesystem Summary:");
        console.log(`  ⚙️  ${insertedMiddleware.length} middleware configurations`);
        console.log(`  🔌 ${insertedPlugins.length} plugin configurations`);
        console.log(`  📄 ${insertedStaticFiles.length} static configuration files`);
        console.log(`  💾 ${insertedBackups.length} backup configurations`);

        return {
            ...ctx,
            insertedMiddleware,
            insertedPlugins,
            insertedStaticFiles,
            insertedBackups,
        };
    }

    /**
     * Mark database as seeded with metadata
     * @param ctx - Final context with all seed data
     * @returns Final context
     */
    private async markDatabaseSeeded(ctx: {
        finalLogs: string[];
        insertedUsers: UserWithRole[];
        masterUser: UserWithRole;
        masterUserHeaders: { Authorization: string; "x-api-key": string };
        masterEmail: string | undefined;
        sharedOrg: Awaited<ReturnType<Auth['api']['createOrganization']>>;
        insertedProjects: typeof projects.$inferSelect[];
        insertedEnvironments: typeof environments.$inferSelect[];
        insertedServices: typeof services.$inferSelect[];
        insertedStaticService: typeof services.$inferSelect[];
        apiService: typeof services.$inferSelect;
        webService: typeof services.$inferSelect;
        githubService: typeof services.$inferSelect;
        insertedGithubApp: typeof githubApps.$inferSelect;
        insertedMiddleware: typeof traefikMiddleware.$inferSelect[];
        insertedPlugins: typeof traefikPlugins.$inferSelect[];
        insertedStaticFiles: typeof traefikStaticFiles.$inferSelect[];
        insertedBackups: typeof traefikBackups.$inferSelect[];
    }) {
        const seedMetadata = {
            usersCount: ctx.insertedUsers.length,
            organizationsCount: 1,
            projectsCount: ctx.insertedProjects.length,
            servicesCount: ctx.insertedServices.length + ctx.insertedStaticService.length,
            deploymentsCount: 0,
            localServicesCreated: [ctx.insertedStaticService[0].name],
            middlewareDefinitions: 4,
            virtualSslCertificates: 1,
            virtualMiddleware: ctx.insertedMiddleware.length,
            virtualPlugins: ctx.insertedPlugins.length,
            virtualStaticFiles: ctx.insertedStaticFiles.length,
            virtualBackups: ctx.insertedBackups.length,
        };
        
        await this.databaseService.db.insert(systemStatus).values({
            id: "system",
            isSeeded: true,
            seedVersion: "2.0.0",
            lastSeededAt: new Date(),
            seedMetadata: seedMetadata,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        
        console.log("✅ Database marked as seeded - future seeding runs will be skipped");
        console.log("\n🎉 Database seeded successfully!");
        console.log("\n📋 Seed Summary:");
        console.log("═".repeat(60));
        ctx.finalLogs.forEach(log => console.log(log));
        console.log("═".repeat(60));

        return ctx;
    }

    async run(): Promise<void> {
        console.log("🌱 Seeding database...");

        try {
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

            // Execute seed operations using builder pattern
            await SeedBuilder.create({ finalLogs: new Array<string>() })
                .use(async (ctx) => this.createUsers(ctx))
                .use(async (ctx) => this.createOrganization(ctx))
                .use(async (ctx) => this.createProjects(ctx))
                .use(async (ctx) => this.createEnvironments(ctx))
                .use(async (ctx) => this.createServices(ctx))
                .use(async (ctx) => this.createGithubProvider(ctx))
                .use(async (ctx) => this.createServiceDependencies(ctx))
                .use(async (ctx) => this.createCollaborations(ctx))
                .use(async (ctx) => this.createAdvancedTraefikConfigurations(ctx))
                .use(async (ctx) => this.markDatabaseSeeded(ctx))
                .build();

            console.log("✅ Database seeded successfully with role-based users and API keys");
        } catch (error) {
            console.error("❌ Seeding failed:", error);
            process.exit(1);
        }
    }
}
