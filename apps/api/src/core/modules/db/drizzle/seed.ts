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
  routeConfigs,
  traefikConfigs,
  configFiles,
  systemStatus
} from './schema';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

// Helper function to create service with Traefik configuration
async function createServiceWithTraefik(serviceData: any, projectId: string, projectDomain: string) {
  // Create the service in database
  const [service] = await db.insert(services).values({
    ...serviceData,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();
  
  console.log(`✅ Created service: ${service.name}`);
  
  // Create Traefik configuration for this service
  if (service.port) {
    // Create domain configuration
    const domainConfig = {
      id: nanoid(),
      traefikInstanceId: 'default', // Use the default Traefik instance
      domain: projectDomain,
      subdomain: service.name,
      fullDomain: `${service.name}.${projectDomain}`,
      sslEnabled: false, // No SSL for localhost
      sslProvider: null,
      middleware: {
        cors: {
          accessControlAllowOrigin: [`http://${projectDomain}`, 'http://localhost:3000'],
          accessControlAllowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
          accessControlAllowHeaders: ['Content-Type', 'Authorization']
        }
      },
      dnsStatus: 'valid' as const, // localhost is always valid
      dnsRecords: null,
      dnsLastChecked: new Date(),
      dnsErrorMessage: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    const [insertedDomainConfig] = await db.insert(domainConfigs).values(domainConfig).returning();
    console.log(`✅ Created domain config: ${domainConfig.fullDomain}`);
    
    // Create route configuration
    const routeConfig = {
      id: nanoid(),
      domainConfigId: insertedDomainConfig.id,
      deploymentId: null, // Will be set when deployment is created
      routeName: `${service.name}-route`,
      serviceName: `${service.name}-service`,
      containerName: `${service.name}-container`,
      targetPort: service.port,
      pathPrefix: '/',
      priority: 1,
      middleware: {
        rateLimit: {
          burst: 100,
          rate: '10/s'
        }
      },
      healthCheck: service.healthCheckPath ? {
        path: service.healthCheckPath,
        interval: '30s',
        timeout: '10s',
        retries: 3
      } : null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    await db.insert(routeConfigs).values(routeConfig);
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
      id: nanoid(),
      traefikInstanceId: 'default',
      configName: `${service.name}-config`,
      configPath: `${service.name}.yml`,
      configContent: traefikConfigContent,
      configType: 'dynamic' as const,
      requiresFile: true,
      syncStatus: 'pending' as const,
      lastSyncedAt: null,
      syncErrorMessage: null,
      fileChecksum: null,
      configVersion: 1,
      metadata: {
        serviceName: service.name,
        serviceId: service.id,
        projectId: projectId,
      },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    await db.insert(traefikConfigs).values(traefikConfigRecord);
    console.log(`✅ Created Traefik config: ${traefikConfigRecord.configName}`);
  }
  
  return service;
}

async function seed() {
  console.log('🌱 Checking database seeding status...');

  try {
    // Check if database has already been seeded
    const existingStatus = await db.select().from(systemStatus).where(eq(systemStatus.id, 'system')).limit(1);
    
    if (existingStatus.length > 0 && existingStatus[0].isSeeded) {
      console.log('✅ Database already seeded. Skipping seeding process.');
      console.log(`📅 Last seeded at: ${existingStatus[0].lastSeededAt}`);
      console.log(`📦 Seed version: ${existingStatus[0].seedVersion}`);
      return;
    }

    console.log('🌱 Database not seeded yet. Starting seeding process...');
    
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
        baseDomain: 'blog.localhost',
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
        baseDomain: 'shop.localhost',
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

    // Create sample services for the first project using Traefik integration
    console.log('🚀 Creating services with Traefik configuration...');
    
    // API Service for blog project
    const apiService = await createServiceWithTraefik({
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
    }, insertedProjects[0].id, insertedProjects[0].baseDomain || 'localhost');

    // Web Service for blog project  
    const webService = await createServiceWithTraefik({
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
        NEXT_PUBLIC_API_URL: 'http://api.blog.localhost'
      } as Record<string, string>,
      resourceLimits: {
        memory: '256m',
        cpu: '0.3'
      },
    }, insertedProjects[0].id, insertedProjects[0].baseDomain || 'localhost');

    const insertedServices = [apiService, webService];
    console.log('✅ Created sample services with Traefik configuration');

    // Create static file service for testing local file deployment
    const staticFileContent = {
      'index.html': `<!DOCTYPE html>
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
      'about.html': `<!DOCTYPE html>
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
      'robots.txt': `User-agent: *
Allow: /

Sitemap: http://static.localhost/sitemap.xml`,
      'sitemap.xml': `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>http://static.localhost/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>http://static.localhost/about.html</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>`
    };

    // Static Service for testing local file deployment
    const staticService = await createServiceWithTraefik({
      projectId: insertedProjects[0].id,
      name: 'static-demo',
      type: 'frontend',
      provider: 'manual' as const,
      builder: 'static' as const,
      providerConfig: {
        instructions: 'Static file deployment with local content',
        deploymentScript: JSON.stringify(staticFileContent)
      },
      builderConfig: {
        outputDirectory: '/'
      },
      port: 80,
      healthCheckPath: '/',
      environmentVariables: {} as Record<string, string>,
      resourceLimits: {
        memory: '64m',
        cpu: '0.1'
      },
    }, insertedProjects[0].id, insertedProjects[0].baseDomain || 'localhost');

    const insertedStaticService = [staticService];
    console.log('✅ Created static file service with Traefik configuration');

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
      containerName: 'blog-api-prod',
      containerImage: 'blog/api:latest',
      domainUrl: 'https://api.blog.localhost',
      healthCheckUrl: 'https://api.blog.localhost/health',
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
      subdomain: 'blog-pr-123',
      fullDomain: 'blog-pr-123.preview.localhost',
      sslEnabled: false, // No SSL for localhost
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

    // Create test Traefik configuration for test.localhost → google.com
    const testDomainConfig = {
      id: nanoid(),
      traefikInstanceId: 'default',
      domain: 'localhost',
      subdomain: 'test',
      fullDomain: 'test.localhost',
      sslEnabled: false, // No SSL for localhost testing
      sslProvider: null,
      middleware: {
        redirectToHttps: false,
        cors: {
          accessControlAllowOrigin: ['*'],
          accessControlAllowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
          accessControlAllowHeaders: ['*'],
        },
      },
      dnsStatus: 'valid' as const,
      dnsRecords: null,
      dnsLastChecked: new Date(),
      dnsErrorMessage: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const insertedTestDomainConfigs = await db.insert(domainConfigs).values(testDomainConfig).returning();
    console.log('✅ Created test.localhost domain configuration');

    // Create test route configuration that redirects to google.com
    const testRouteConfig = {
      id: nanoid(),
      domainConfigId: insertedTestDomainConfigs[0].id,
      deploymentId: null, // No deployment, this is a redirect
      routeName: 'test-redirect-route',
      serviceName: 'redirect-to-google',
      containerName: null,
      targetPort: 80, // Required field, use port 80 for redirect service
      pathPrefix: '/',
      priority: 1,
      middleware: {
        redirect: {
          regex: '^https?://test\\.localhost/(.*)',
          replacement: 'https://google.com/$1',
          permanent: false, // Temporary redirect for testing
        },
      },
      healthCheck: null, // No health check for redirect
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(routeConfigs).values(testRouteConfig);
    console.log('✅ Created test redirect route configuration');

    // Create Traefik configuration file record for test redirect
    const testTraefikConfigRecord = {
      id: nanoid(),
      traefikInstanceId: 'default',
      configName: 'test-redirect-config',
      configPath: 'test-redirect.yml',
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
      configType: 'dynamic',
      requiresFile: true,
      syncStatus: 'pending' as const,
      lastSyncedAt: null,
      syncErrorMessage: null,
      fileChecksum: null,
      configVersion: 1,
      metadata: {
        purpose: 'test-redirect',
        target: 'google.com',
      },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const insertedTestTraefikConfigs = await db.insert(traefikConfigs).values(testTraefikConfigRecord).returning();
    console.log('✅ Created test Traefik configuration record');

    // Create configuration file record for test redirect
    const testConfigFileRecord = {
      id: nanoid(),
      traefikConfigId: insertedTestTraefikConfigs[0].id,
      filePath: 'test-redirect.yml',
      fileSize: Buffer.byteLength(testTraefikConfigRecord.configContent, 'utf8'),
      checksum: null, // Will be calculated when file is written
      permissions: '644',
      owner: 'traefik',
      exists: false,
      isWritable: true,
      lastWriteAttempt: null,
      writeErrorMessage: null,
      containerPath: '/etc/traefik/dynamic/test-redirect.yml',
      mountPoint: './traefik-configs:/etc/traefik/dynamic',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(configFiles).values(testConfigFileRecord);
    console.log('✅ Created test configuration file record');

    console.log('\n🎉 Database seeded successfully with:');
    console.log('  👥 2 sample users');
    console.log('  🏗️  2 sample projects');
    console.log('  ⚙️  3 sample services with automatic Traefik configuration');
    console.log('  🚀 1 sample deployment');
    console.log('  📋 6 deployment logs');
    console.log('  🔮 1 preview environment');
    console.log('  🔀 1 Traefik instance');
    console.log('  🌐 4 domain configurations (3 services + 1 test redirect)');
    console.log('  🛣️  4 route configurations (3 services + 1 test redirect)');
    console.log('  🤝 1 collaboration');
    console.log('  📁 4 Traefik config files (3 services + 1 test)');
    console.log('  📄 Service-specific config file records');
    console.log('\n🧪 Service Domains Created:');
    console.log('  🌐 api.blog.localhost → API service');
    console.log('  🌐 web.blog.localhost → Web service');
    console.log('  🌐 static-demo.blog.localhost → Static demo service');
    console.log('  🎯 test.localhost → google.com redirect');
    console.log('\n✨ Traefik Integration Features:');
    console.log('  🔄 Automatic Traefik configuration per service');
    console.log('  🌍 DNS validation for localhost domains');
    console.log('  📊 Config file sync handling');
    console.log('  🚦 CORS and rate limiting middleware');
    console.log('  💉 Health check configuration');
    console.log('\n🔧 To test:');
    console.log('  1. Start services: bun run dev');
    console.log('  2. Add to /etc/hosts: 127.0.0.1 api.blog.localhost web.blog.localhost static-demo.blog.localhost test.localhost');
    console.log('  3. Visit: http://test.localhost (should redirect to Google)');
    console.log('  4. Visit: http://api.blog.localhost (API service)');
    console.log('  5. Visit: http://web.blog.localhost (Web service)');
    console.log('  6. Deploy services and test Traefik routing');

    // Mark database as seeded
    const seedMetadata = {
      usersCount: insertedUsers.length,
      projectsCount: insertedProjects.length,
      servicesCount: insertedServices.length + insertedStaticService.length,
      deploymentsCount: insertedDeployments.length,
      localServicesCreated: [insertedStaticService[0].name]
    };

    await db.insert(systemStatus).values({
      id: 'system',
      isSeeded: true,
      seedVersion: '1.0.0',
      lastSeededAt: new Date(),
      seedMetadata: seedMetadata,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log('✅ Database marked as seeded - future seeding runs will be skipped');
    
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seed();