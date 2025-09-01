import { db } from './index';
import { 
  user, 
  projects, 
  services, 
  serviceDependencies,
  projectCollaborators,
  deployments,
  deploymentLogs,
  previewEnvironments,
  traefikInstances,
  domainConfigs,
  routeConfigs
} from './schema';
import { nanoid } from 'nanoid';

async function seed() {
  console.log('🌱 Seeding database...');

  try {
    // Create sample users
    const sampleUsers = [
      {
        id: nanoid(),
        name: 'John Doe',
        email: 'john@example.com',
        emailVerified: true,
        image: 'https://avatars.githubusercontent.com/u/1?v=4',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: nanoid(),
        name: 'Jane Smith',
        email: 'jane@example.com',
        emailVerified: true,
        image: 'https://avatars.githubusercontent.com/u/2?v=4',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const insertedUsers = await db.insert(user).values(sampleUsers).returning();
    console.log('✅ Created sample users');

    // Create default Traefik instance
    const defaultTraefikInstance = {
      id: 'default',
      name: 'Default Traefik',
      status: 'running' as const,
      containerId: null, // Will be set when container is started
      httpPort: 80,
      httpsPort: 443,
      dashboardPort: 8080,
      acmeEmail: 'admin@example.com',
      logLevel: 'INFO',
      insecureApi: true, // For development
      config: {
        entrypoints: {
          web: { address: ':80' },
          websecure: { address: ':443' },
        },
        certificatesResolvers: {
          letsencrypt: {
            acme: {
              email: 'admin@example.com',
              storage: '/data/acme.json',
              httpChallenge: {
                entryPoint: 'web',
              },
            },
          },
        },
        providers: {
          docker: {
            exposedByDefault: false,
          },
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(traefikInstances).values(defaultTraefikInstance);
    console.log('✅ Created default Traefik instance');

    // Create sample projects
    const sampleProjects = [
      {
        name: 'My Blog',
        description: 'Personal blog with Next.js frontend and NestJS API',
        baseDomain: 'myblog.example.com',
        ownerId: insertedUsers[0].id,
        settings: {
          autoCleanupDays: 7,
          maxPreviewEnvironments: 5,
          defaultEnvironmentVariables: {
            NODE_ENV: 'development',
            PORT: '3000'
          }
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'E-commerce Store',
        description: 'Online store with React frontend, Node.js API, and PostgreSQL',
        baseDomain: 'store.example.com',
        ownerId: insertedUsers[1].id,
        settings: {
          autoCleanupDays: 14,
          maxPreviewEnvironments: 10
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    ];

    const insertedProjects = await db.insert(projects).values(sampleProjects).returning();
    console.log('✅ Created sample projects');

    // Create sample services for the first project
    const sampleServices = [
      {
        projectId: insertedProjects[0].id,
        name: 'api',
        type: 'backend',
        provider: 'github' as const,
        builder: 'dockerfile' as const,
        providerConfig: {
          repositoryUrl: 'https://github.com/example/api-service',
          branch: 'main'
        },
        builderConfig: {
          dockerfilePath: 'apps/api/Dockerfile',
          buildContext: '.'
        },
        port: 3001,
        healthCheckPath: '/health',
        environmentVariables: {
          DATABASE_URL: 'postgresql://user:pass@db:5432/mydb',
          REDIS_URL: 'redis://redis:6379'
        } as Record<string, string>,
        resourceLimits: {
          memory: '512m',
          cpu: '0.5'
        },
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        projectId: insertedProjects[0].id,
        name: 'web',
        type: 'frontend',
        provider: 'github' as const,
        builder: 'nixpack' as const,
        providerConfig: {
          repositoryUrl: 'https://github.com/example/web-app',
          branch: 'main'
        },
        builderConfig: {
          buildCommand: 'npm run build',
          outputDirectory: '.next'
        },
        port: 3000,
        healthCheckPath: '/',
        environmentVariables: {
          NEXT_PUBLIC_API_URL: 'http://api:3001'
        } as Record<string, string>,
        resourceLimits: {
          memory: '256m',
          cpu: '0.3'
        },
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    ];

    const insertedServices = await db.insert(services).values(sampleServices).returning();
    console.log('✅ Created sample services');

    // Create service dependency (web depends on api)
    const serviceDependency = {
      serviceId: insertedServices[1].id, // web
      dependsOnServiceId: insertedServices[0].id, // api
      isRequired: true,
      createdAt: new Date(),
    };

    await db.insert(serviceDependencies).values(serviceDependency);
    console.log('✅ Created service dependencies');

    // Add collaborator to first project
    const collaboration = {
      projectId: insertedProjects[0].id,
      userId: insertedUsers[1].id,
      role: 'developer' as const,
      permissions: {
        canDeploy: true,
        canManageServices: false,
        canManageCollaborators: false,
        canViewLogs: true,
        canDeleteDeployments: false
      },
      invitedBy: insertedUsers[0].id,
      invitedAt: new Date(),
      acceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(projectCollaborators).values(collaboration);
    console.log('✅ Created project collaborations');

    // Create sample deployment
    const sampleDeployment = {
      serviceId: insertedServices[0].id,
      triggeredBy: insertedUsers[0].id,
      status: 'success' as const,
      environment: 'production' as const,
      sourceType: 'github' as const,
      sourceConfig: {
        repositoryUrl: 'https://github.com/user/my-blog',
        branch: 'main',
        commitSha: 'abc123def456',
      },
      buildStartedAt: new Date(Date.now() - 300000), // 5 minutes ago
      buildCompletedAt: new Date(Date.now() - 240000), // 4 minutes ago
      deployStartedAt: new Date(Date.now() - 240000),
      deployCompletedAt: new Date(Date.now() - 180000), // 3 minutes ago
      containerName: 'myblog-api-prod',
      containerImage: 'myblog/api:latest',
      domainUrl: 'https://api.myblog.example.com',
      healthCheckUrl: 'https://api.myblog.example.com/health',
      metadata: {
        buildDuration: 60000,
        deployDuration: 60000,
        stage: 'completed',
        progress: 100,
        version: '1.0.0',
        branch: 'main'
      },
      createdAt: new Date(Date.now() - 300000),
      updatedAt: new Date(Date.now() - 180000),
    };

    const insertedDeployments = await db.insert(deployments).values(sampleDeployment).returning();
    console.log('✅ Created sample deployment');

    // Create sample deployment logs
    const sampleLogs = [
      {
        deploymentId: insertedDeployments[0].id,
        level: 'info' as const,
        message: 'Starting deployment process',
        phase: 'build',
        step: 'initialize',
        timestamp: new Date(Date.now() - 300000),
      },
      {
        deploymentId: insertedDeployments[0].id,
        level: 'info' as const,
        message: 'Cloning repository from GitHub',
        phase: 'build',
        step: 'clone-repository',
        timestamp: new Date(Date.now() - 290000),
      },
      {
        deploymentId: insertedDeployments[0].id,
        level: 'info' as const,
        message: 'Building Docker image',
        phase: 'build',
        step: 'docker-build',
        timestamp: new Date(Date.now() - 280000),
      },
      {
        deploymentId: insertedDeployments[0].id,
        level: 'info' as const,
        message: 'Starting container',
        phase: 'deploy',
        step: 'start-container',
        timestamp: new Date(Date.now() - 190000),
      },
      {
        deploymentId: insertedDeployments[0].id,
        level: 'info' as const,
        message: 'Configuring Traefik routes',
        phase: 'deploy',
        step: 'configure-proxy',
        timestamp: new Date(Date.now() - 185000),
      },
      {
        deploymentId: insertedDeployments[0].id,
        level: 'info' as const,
        message: 'Deployment completed successfully',
        phase: 'deploy',
        step: 'complete',
        timestamp: new Date(Date.now() - 180000),
      }
    ];

    await db.insert(deploymentLogs).values(sampleLogs);
    console.log('✅ Created sample deployment logs');

    // Create preview environment
    const previewEnv = {
      deploymentId: insertedDeployments[0].id,
      subdomain: 'myblog-pr-123',
      fullDomain: 'myblog-pr-123.preview.example.com',
      sslEnabled: true,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      isActive: true,
      webhookTriggered: true,
      environmentVariables: {
        NODE_ENV: 'preview',
        PREVIEW_MODE: 'true'
      } as Record<string, string>,
      metadata: {
        pullRequestUrl: 'https://github.com/user/my-blog/pull/123',
        branchName: 'feature/new-design',
        lastAccessedAt: new Date().toISOString(),
        accessCount: 15
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(previewEnvironments).values(previewEnv);
    console.log('✅ Created preview environment');

    // Create domain configuration for Traefik
    const domainConfig = {
      id: nanoid(),
      traefikInstanceId: 'default',
      domain: 'myblog.example.com',
      subdomain: 'api',
      fullDomain: 'api.myblog.example.com',
      sslEnabled: true,
      sslProvider: 'letsencrypt',
      middleware: {
        cors: {
          accessControlAllowOrigin: ['https://myblog.example.com'],
          accessControlAllowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
          accessControlAllowHeaders: ['Content-Type', 'Authorization']
        }
      },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const insertedDomainConfigs = await db.insert(domainConfigs).values(domainConfig).returning();
    console.log('✅ Created domain configuration');

    // Create route configuration
    const routeConfig = {
      id: nanoid(),
      domainConfigId: insertedDomainConfigs[0].id,
      deploymentId: insertedDeployments[0].id,
      routeName: 'myblog-api-route',
      serviceName: 'myblog-api-service',
      containerName: 'myblog-api-prod',
      targetPort: 3001,
      pathPrefix: '/',
      priority: 1,
      middleware: {
        rateLimit: {
          burst: 100,
          rate: '10/s'
        }
      },
      healthCheck: {
        path: '/health',
        interval: '30s',
        timeout: '10s',
        retries: 3
      },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(routeConfigs).values(routeConfig);
    console.log('✅ Created route configuration');

    console.log('\n🎉 Database seeded successfully with:');
    console.log('  👥 2 sample users');
    console.log('  🏗️  2 sample projects');
    console.log('  ⚙️  2 sample services');
    console.log('  🚀 1 sample deployment');
    console.log('  📋 6 deployment logs');
    console.log('  🔮 1 preview environment');
    console.log('  🔀 1 Traefik instance');
    console.log('  🌐 1 domain configuration');
    console.log('  🛣️  1 route configuration');
    console.log('  🤝 1 collaboration');
    
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seed();