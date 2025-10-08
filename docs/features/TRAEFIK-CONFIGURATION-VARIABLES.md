# Traefik Configuration Variables

This document describes all available variables that can be used in Traefik service configurations.

## Overview

When a service is created, the provider generates a default Traefik configuration with template variables. These variables are stored in the database and resolved during Traefik sync operations with actual deployment values.

## Variable Categories

### Service Variables

Variables related to the service itself:

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `{{serviceName}}` | Name of the service | `api`, `web`, `worker` |
| `{{serviceId}}` | UUID of the service | `550e8400-e29b-41d4-a716-446655440000` |
| `{{serviceType}}` | Type of service | `web`, `worker`, `database` |

### Deployment Variables

Variables related to the specific deployment:

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `{{deploymentId}}` | UUID of the deployment | `660e8400-e29b-41d4-a716-446655440000` |
| `{{containerName}}` | Docker container name | `deployment-123-api` |
| `{{containerPort}}` | Container internal port | `3000`, `8080` |
| `{{containerId}}` | Docker container ID | `abc123def456` |

### Domain Variables

Variables for domain and routing:

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `{{domain}}` | Main domain | `example.com` |
| `{{subdomain}}` | Subdomain prefix | `api`, `staging` |
| `{{fullDomain}}` | Complete domain | `api.example.com` |
| `{{baseDomain}}` | Project base domain | `myapp.example.com` |

### SSL/TLS Variables

Variables for SSL certificate configuration:

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `{{certFile}}` | Path to certificate file | `/certs/example.com.crt` |
| `{{keyFile}}` | Path to private key file | `/certs/example.com.key` |
| `{{certResolver}}` | Certificate resolver name | `letsencrypt` |

### Path Variables

Variables for URL paths and routing:

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `{{pathPrefix}}` | URL path prefix | `/api`, `/v1` |
| `{{healthCheckPath}}` | Health check endpoint | `/health`, `/api/health` |

### Network Variables

Variables for Docker networking:

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `{{networkName}}` | Docker network name | `traefik-network` |
| `{{networkId}}` | Docker network ID | `abc123` |

### Project Variables

Variables related to the project:

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `{{projectId}}` | UUID of the project | `770e8400-e29b-41d4-a716-446655440000` |
| `{{projectName}}` | Name of the project | `my-app` |
| `{{environment}}` | Deployment environment | `production`, `staging`, `preview` |

### Route Variables

Advanced routing configuration variables:

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `{{routerName}}` | Traefik router name | `api-router` |
| `{{traefikServiceName}}` | Traefik service name | `api-service` |
| `{{middlewareName}}` | Middleware name | `cors-middleware` |
| `{{entryPoint}}` | Traefik entry point | `web`, `websecure` |
| `{{priority}}` | Router priority | `100` |

## Usage Examples

### Basic Service Configuration

```yaml
http:
  routers:
    {{serviceName}}-router:
      rule: "Host(`{{fullDomain}}`)"
      service: {{serviceName}}-service
      entryPoints:
        - web
  
  services:
    {{serviceName}}-service:
      loadBalancer:
        servers:
          - url: "http://{{containerName}}:{{containerPort}}"
        healthCheck:
          path: {{healthCheckPath}}
          interval: 10s
```

### SSL-Enabled Configuration

```yaml
http:
  routers:
    {{serviceName}}-secure:
      rule: "Host(`{{fullDomain}}`)"
      service: {{serviceName}}-service
      entryPoints:
        - websecure
      tls:
        certResolver: {{certResolver}}

tls:
  certificates:
    - certFile: {{certFile}}
      keyFile: {{keyFile}}
```

### Multi-Path Routing

```yaml
http:
  routers:
    {{serviceName}}-api:
      rule: "Host(`{{domain}}`) && PathPrefix(`{{pathPrefix}}`)"
      service: {{serviceName}}-service
      priority: {{priority}}
      middlewares:
        - {{middlewareName}}
```

## Resolution Process

1. **Service Creation**: Provider generates default config with variables
   ```typescript
   const config = provider.getDefaultTraefikConfig({
     domain: '{{domain}}',
     enableSSL: true
   });
   ```

2. **Database Storage**: Config stored with variables intact
   ```typescript
   await db.insert(services).values({
     ...serviceData,
     traefikConfig: config // Serialized with variables
   });
   ```

3. **Traefik Sync**: Variables resolved during file sync
   ```typescript
   const context = {
     service: { id: service.id, name: service.name },
     deployment: { containerName: 'deployment-123', containerPort: 3000 },
     domain: { fullDomain: 'api.example.com' }
   };
   
   const resolvedConfig = variableResolver.resolveBuilder(config, context);
   ```

## Custom Variables

You can also use custom variables:

```typescript
const context = {
  // ... standard context
  custom: {
    apiVersion: 'v1',
    region: 'us-east-1',
    tier: 'premium'
  }
};

// In config: {{apiVersion}}, {{region}}, {{tier}}
```

## Best Practices

1. **Use Variables for Dynamic Values**: Always use variables for values that change per deployment
2. **Keep Defaults Simple**: Provider defaults should work for most cases
3. **Document Custom Variables**: If adding custom variables, document them clearly
4. **Validate Before Resolution**: Check that all required variables are available before resolving
5. **Handle Missing Variables**: Provide sensible defaults or clear error messages

## API Reference

### TraefikVariableResolverService

```typescript
class TraefikVariableResolverService {
  // Get all available variables
  getAvailableVariables(): typeof TRAEFIK_VARIABLES;
  
  // Build variable map from context
  buildVariableMap(context: VariableResolutionContext): Record<string, string>;
  
  // Resolve variables in a string
  resolveString(template: string, context: VariableResolutionContext): string;
  
  // Resolve variables in a config object
  resolveConfig(config: any, context: VariableResolutionContext): any;
  
  // Resolve variables in a builder
  resolveBuilder(builder: TraefikConfigBuilder, context: VariableResolutionContext): TraefikConfigBuilder;
  
  // Check if text contains variables
  hasVariables(text: string): boolean;
  
  // Extract all variables from text
  extractVariables(text: string): string[];
  
  // Validate context has all required variables
  validateContext(template: string, context: VariableResolutionContext): {
    valid: boolean;
    missingVariables: string[];
  };
}
```

### VariableResolutionContext

```typescript
interface VariableResolutionContext {
  service?: {
    id: string;
    name: string;
    type: string;
    port?: number;
    healthCheckPath?: string;
  };
  
  deployment?: {
    id: string;
    containerName: string;
    containerPort: number;
    containerId?: string;
    environment: string;
  };
  
  domain?: {
    domain: string;
    subdomain?: string;
    fullDomain: string;
    baseDomain?: string;
  };
  
  ssl?: {
    certFile?: string;
    keyFile?: string;
    certResolver?: string;
  };
  
  path?: {
    prefix?: string;
    healthCheck?: string;
  };
  
  network?: {
    name: string;
    id?: string;
  };
  
  project?: {
    id: string;
    name: string;
  };
  
  route?: {
    routerName?: string;
    serviceName?: string;
    middlewareName?: string;
    entryPoint?: string;
    priority?: number;
  };
  
  custom?: Record<string, string | number | boolean>;
}
```

## Integration Example

Complete flow from service creation to Traefik sync:

```typescript
// 1. Service creation - Provider generates config with variables
const githubProvider = new GithubProviderService(...);
const defaultConfig = githubProvider.getDefaultTraefikConfig({
  enableSSL: true,
  enableCORS: true
});

// 2. Save service with config to database
const service = await db.insert(services).values({
  projectId: project.id,
  name: 'api',
  type: 'web',
  provider: 'github',
  traefikConfig: defaultConfig // Auto-serialized with variables intact
});

// 3. During deployment - Traefik sync resolves variables
const deployment = await createDeployment(service);

const context: VariableResolutionContext = {
  service: {
    id: service.id,
    name: service.name,
    type: service.type,
    port: service.port,
    healthCheckPath: service.healthCheckPath
  },
  deployment: {
    id: deployment.id,
    containerName: deployment.containerName,
    containerPort: deployment.containerPort,
    environment: deployment.environment
  },
  domain: {
    domain: 'example.com',
    subdomain: 'api',
    fullDomain: 'api.example.com'
  },
  ssl: {
    certResolver: 'letsencrypt'
  },
  network: {
    name: 'traefik-network'
  },
  project: {
    id: project.id,
    name: project.name
  }
};

// 4. Resolve variables
const variableResolver = new TraefikVariableResolverService();
const resolvedBuilder = variableResolver.resolveBuilder(
  service.traefikConfig, // Auto-deserialized to builder
  context
);

// 5. Generate final YAML for Traefik
const yamlConfig = TraefikConfigBuilder.toYAMLString(
  resolvedBuilder.build()
);

// 6. Write to Traefik config file
await writeTraefikConfig(yamlConfig);
```
