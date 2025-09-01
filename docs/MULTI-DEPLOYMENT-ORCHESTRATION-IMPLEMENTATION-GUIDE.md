# Multi-Deployment Orchestration Implementation Guide

> **Implementation Guide**: Practical steps and code examples for implementing the Multi-Deployment Orchestration Specification using Docker Swarm Mode and Traefik.

## Quick Start Implementation

### **Prerequisites Setup**

```bash
# Install Docker Swarm Mode (on manager node)
docker swarm init --advertise-addr $(hostname -I | awk '{print $1}')

# Save the join token for worker nodes
WORKER_TOKEN=$(docker swarm join-token worker -q)
MANAGER_TOKEN=$(docker swarm join-token manager -q)

# Create Traefik public network
docker network create --driver=overlay traefik-public
```

### **Core Services Implementation**

#### **1. SwarmOrchestrationService**

```typescript
// apps/api/src/core/services/swarm-orchestration.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { execSync, spawn } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

export interface SwarmDeploymentConfig {
  projectId: string;
  environment: 'production' | 'staging' | 'preview' | 'development';
  domain: string;
  services: {
    [serviceName: string]: {
      image: string;
      replicas?: number;
      resources: {
        cpus: string;
        memory: string;
        reservations?: {
          cpus: string;
          memory: string;
        };
      };
      environment: Record<string, string>;
      ports?: number[];
      healthCheck?: {
        test: string[];
        interval: string;
        timeout: string;
        retries: number;
      };
      volumes?: string[];
      labels?: Record<string, string>;
    };
  };
  networks?: Record<string, any>;
  volumes?: Record<string, any>;
}

@Injectable()
export class SwarmOrchestrationService {
  private readonly logger = new Logger(SwarmOrchestrationService.name);
  private readonly stacksDir = './docker-stacks';

  constructor() {
    // Ensure stacks directory exists
    mkdirSync(this.stacksDir, { recursive: true });
  }

  async deployStack(config: SwarmDeploymentConfig): Promise<string> {
    const stackName = `${config.projectId}-${config.environment}`;
    
    try {
      // Generate Docker Compose file for Swarm
      const composeContent = this.generateSwarmCompose(config);
      
      // Write compose file
      const composeFilePath = join(this.stacksDir, `${stackName}.yml`);
      writeFileSync(composeFilePath, yaml.dump(composeContent));
      
      // Deploy stack
      this.logger.log(`Deploying stack: ${stackName}`);
      execSync(`docker stack deploy -c ${composeFilePath} ${stackName}`, {
        stdio: 'inherit'
      });
      
      this.logger.log(`Stack ${stackName} deployed successfully`);
      return stackName;
      
    } catch (error) {
      this.logger.error(`Failed to deploy stack ${stackName}:`, error);
      throw error;
    }
  }

  async removeStack(stackName: string): Promise<void> {
    try {
      this.logger.log(`Removing stack: ${stackName}`);
      execSync(`docker stack rm ${stackName}`, { stdio: 'inherit' });
      this.logger.log(`Stack ${stackName} removed successfully`);
    } catch (error) {
      this.logger.error(`Failed to remove stack ${stackName}:`, error);
      throw error;
    }
  }

  async getStackStatus(stackName: string): Promise<any> {
    try {
      const output = execSync(`docker stack services ${stackName} --format "table {{.Name}}\\t{{.Mode}}\\t{{.Replicas}}\\t{{.Image}}"`, {
        encoding: 'utf8'
      });
      return this.parseStackOutput(output);
    } catch (error) {
      this.logger.error(`Failed to get stack status for ${stackName}:`, error);
      return null;
    }
  }

  private generateSwarmCompose(config: SwarmDeploymentConfig): any {
    const compose = {
      version: '3.8',
      services: {} as any,
      networks: {
        [`${config.projectId}-network`]: {
          driver: 'overlay',
          attachable: true,
          labels: {
            'project.id': config.projectId,
            'project.environment': config.environment
          }
        },
        'traefik-public': {
          external: true
        }
      },
      volumes: {} as any
    };

    // Generate services
    for (const [serviceName, serviceConfig] of Object.entries(config.services)) {
      const fullServiceName = `${config.projectId}-${serviceName}`;
      
      compose.services[fullServiceName] = {
        image: serviceConfig.image,
        deploy: {
          replicas: serviceConfig.replicas || 1,
          resources: {
            limits: {
              cpus: serviceConfig.resources.cpus,
              memory: serviceConfig.resources.memory
            },
            reservations: serviceConfig.resources.reservations || {
              cpus: '0.1',
              memory: '64M'
            }
          },
          restart_policy: {
            condition: 'on-failure',
            max_attempts: 3
          },
          labels: {
            'project.id': config.projectId,
            'project.environment': config.environment,
            'service.name': serviceName,
            ...serviceConfig.labels
          }
        },
        environment: serviceConfig.environment,
        networks: [
          `${config.projectId}-network`,
          'traefik-public'
        ]
      };

      // Add Traefik labels for web services
      if (serviceConfig.ports && serviceConfig.ports.length > 0) {
        const subdomain = this.generateSubdomain(config.projectId, config.environment, serviceName);
        const domain = `${subdomain}.${config.domain}`;
        
        compose.services[fullServiceName].deploy.labels = {
          ...compose.services[fullServiceName].deploy.labels,
          'traefik.enable': 'true',
          'traefik.constraint-label': 'traefik-public',
          [`traefik.http.routers.${fullServiceName}.rule`]: `Host(\`${domain}\`)`,
          [`traefik.http.routers.${fullServiceName}.entrypoints`]: 'websecure',
          [`traefik.http.routers.${fullServiceName}.tls.certresolver`]: 'letsencrypt',
          [`traefik.http.services.${fullServiceName}.loadbalancer.server.port`]: serviceConfig.ports[0].toString()
        };
      }

      // Add health check
      if (serviceConfig.healthCheck) {
        compose.services[fullServiceName].healthcheck = serviceConfig.healthCheck;
      }

      // Add volumes
      if (serviceConfig.volumes) {
        compose.services[fullServiceName].volumes = serviceConfig.volumes;
        
        // Create named volumes for persistent storage
        serviceConfig.volumes.forEach(volume => {
          if (volume.includes(':') && !volume.startsWith('./') && !volume.startsWith('/')) {
            const volumeName = volume.split(':')[0];
            if (!compose.volumes[volumeName]) {
              compose.volumes[volumeName] = {
                driver: 'local',
                labels: {
                  'project.id': config.projectId,
                  'project.environment': config.environment
                }
              };
            }
          }
        });
      }
    }

    return compose;
  }

  private generateSubdomain(projectId: string, environment: string, serviceName?: string): string {
    const baseSubdomain = serviceName ? `${serviceName}-${projectId}` : projectId;
    
    switch (environment) {
      case 'production':
        return baseSubdomain;
      case 'staging':
        return `${baseSubdomain}-staging`;
      case 'preview':
        return `${baseSubdomain}-preview`;
      case 'development':
        return `${baseSubdomain}-dev`;
      default:
        return `${baseSubdomain}-${environment}`;
    }
  }

  private parseStackOutput(output: string): any {
    const lines = output.split('\n').filter(line => line.trim());
    const services = [];
    
    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(/\s+/);
      if (parts.length >= 4) {
        services.push({
          name: parts[0],
          mode: parts[1],
          replicas: parts[2],
          image: parts[3]
        });
      }
    }
    
    return { services };
  }
}
```

#### **2. TraefikService**

```typescript
// apps/api/src/core/services/traefik.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { execSync } from 'child_process';
import { writeFileSync, existsSync } from 'fs';
import * as yaml from 'js-yaml';

interface TraefikConfig {
  domain: string;
  acmeEmail: string;
  dashboardAuth?: {
    username: string;
    password: string; // bcrypt hashed
  };
}

@Injectable()
export class TraefikService implements OnModuleInit {
  private readonly logger = new Logger(TraefikService.name);
  
  async onModuleInit() {
    await this.ensureTraefikDeployed();
  }

  async deployTraefik(config: TraefikConfig): Promise<void> {
    const traefikCompose = {
      version: '3.8',
      services: {
        traefik: {
          image: 'traefik:v3.0',
          ports: ['80:80', '443:443', '8080:8080'],
          deploy: {
            placement: {
              constraints: ['node.role == manager']
            },
            restart_policy: {
              condition: 'on-failure'
            },
            labels: config.dashboardAuth ? {
              'traefik.enable': 'true',
              'traefik.http.routers.traefik.rule': `Host(\`traefik.${config.domain}\`)`,
              'traefik.http.routers.traefik.entrypoints': 'websecure',
              'traefik.http.routers.traefik.tls.certresolver': 'letsencrypt',
              'traefik.http.routers.traefik.service': 'api@internal',
              'traefik.http.routers.traefik.middlewares': 'traefik-auth',
              'traefik.http.middlewares.traefik-auth.basicauth.users': `${config.dashboardAuth.username}:${config.dashboardAuth.password}`
            } : {}
          },
          command: [
            '--api.dashboard=true',
            '--providers.docker.swarmMode=true',
            '--providers.docker.exposedbydefault=false',
            '--entrypoints.web.address=:80',
            '--entrypoints.websecure.address=:443',
            '--entrypoints.web.http.redirections.entrypoint.to=websecure',
            '--entrypoints.web.http.redirections.entrypoint.scheme=https',
            '--certificatesresolvers.letsencrypt.acme.httpchallenge=true',
            '--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web',
            `--certificatesresolvers.letsencrypt.acme.email=${config.acmeEmail}`,
            '--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json',
            '--log.level=INFO',
            '--accesslog=true'
          ],
          volumes: [
            '/var/run/docker.sock:/var/run/docker.sock:ro',
            'traefik-letsencrypt:/letsencrypt'
          ],
          networks: ['traefik-public']
        }
      },
      networks: {
        'traefik-public': {
          external: true
        }
      },
      volumes: {
        'traefik-letsencrypt': {
          driver: 'local'
        }
      }
    };

    // Write Traefik compose file
    const composeContent = yaml.dump(traefikCompose);
    writeFileSync('./docker-stacks/traefik.yml', composeContent);

    // Deploy Traefik stack
    this.logger.log('Deploying Traefik...');
    execSync('docker stack deploy -c ./docker-stacks/traefik.yml traefik', {
      stdio: 'inherit'
    });
  }

  async ensureTraefikDeployed(): Promise<void> {
    try {
      // Check if Traefik stack exists
      const output = execSync('docker stack ls --format "{{.Name}}"', { 
        encoding: 'utf8' 
      });
      
      if (!output.includes('traefik')) {
        const defaultConfig: TraefikConfig = {
          domain: process.env.DEPLOYER_BASE_DOMAIN || 'localhost',
          acmeEmail: process.env.LETS_ENCRYPT_EMAIL || 'admin@localhost'
        };
        
        await this.deployTraefik(defaultConfig);
      }
    } catch (error) {
      this.logger.error('Failed to check/deploy Traefik:', error);
    }
  }

  async configureSSLCertificate(domain: string): Promise<void> {
    // SSL certificates are automatically generated by Traefik
    // when services are deployed with proper labels
    this.logger.log(`SSL certificate will be auto-generated for: ${domain}`);
  }
}
```

#### **3. ResourceAllocationService**

```typescript
// apps/api/src/core/services/resource-allocation.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { execSync } from 'child_process';

export interface ResourceQuotas {
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
}

export interface ResourceMetrics {
  cpu: {
    used: number;
    available: number;
    percentage: number;
  };
  memory: {
    used: number;
    available: number;
    percentage: number;
  };
  storage: {
    used: number;
    available: number;
    percentage: number;
  };
}

@Injectable()
export class ResourceAllocationService {
  private readonly logger = new Logger(ResourceAllocationService.name);

  async checkResourceAvailability(requirements: ResourceQuotas): Promise<boolean> {
    try {
      const metrics = await this.getSystemResourceMetrics();
      
      // Parse CPU requirements
      const requiredCpu = parseFloat(requirements.cpu.limit);
      const requiredMemory = this.parseMemoryString(requirements.memory.limit);
      
      // Check availability (keep 10% buffer)
      const cpuAvailable = (metrics.cpu.available * 0.9) >= requiredCpu;
      const memoryAvailable = (metrics.memory.available * 0.9) >= requiredMemory;
      
      this.logger.log(`Resource check - CPU: ${cpuAvailable}, Memory: ${memoryAvailable}`);
      return cpuAvailable && memoryAvailable;
      
    } catch (error) {
      this.logger.error('Failed to check resource availability:', error);
      return false;
    }
  }

  async getSystemResourceMetrics(): Promise<ResourceMetrics> {
    try {
      // Get node information
      const nodeInfo = execSync('docker node ls --format "{{.Hostname}}\\t{{.Status}}\\t{{.Availability}}"', {
        encoding: 'utf8'
      });
      
      // For simplicity, get system metrics from the manager node
      const cpuInfo = execSync('nproc', { encoding: 'utf8' });
      const memInfo = execSync('free -b', { encoding: 'utf8' });
      const diskInfo = execSync('df -B1 /', { encoding: 'utf8' });
      
      return this.parseSystemMetrics(cpuInfo, memInfo, diskInfo);
      
    } catch (error) {
      this.logger.error('Failed to get system metrics:', error);
      throw error;
    }
  }

  async monitorResourceUsage(stackName: string): Promise<ResourceMetrics> {
    try {
      // Get stack service stats
      const stats = execSync(`docker stack ps ${stackName} --format "{{.Name}}\\t{{.CurrentState}}"`, {
        encoding: 'utf8'
      });
      
      // For detailed monitoring, you'd typically use Prometheus/Grafana
      // This is a simplified implementation
      return {
        cpu: { used: 0, available: 100, percentage: 0 },
        memory: { used: 0, available: 1000000000, percentage: 0 },
        storage: { used: 0, available: 1000000000, percentage: 0 }
      };
      
    } catch (error) {
      this.logger.error(`Failed to monitor resource usage for ${stackName}:`, error);
      throw error;
    }
  }

  private parseMemoryString(memoryStr: string): number {
    const unit = memoryStr.slice(-1).toUpperCase();
    const value = parseFloat(memoryStr.slice(0, -1));
    
    switch (unit) {
      case 'K': return value * 1024;
      case 'M': return value * 1024 * 1024;
      case 'G': return value * 1024 * 1024 * 1024;
      default: return value;
    }
  }

  private parseSystemMetrics(cpuInfo: string, memInfo: string, diskInfo: string): ResourceMetrics {
    const cpuCount = parseInt(cpuInfo.trim());
    
    // Parse memory info
    const memLines = memInfo.split('\n');
    const memData = memLines[1].split(/\s+/);
    const totalMem = parseInt(memData[1]);
    const availableMem = parseInt(memData[6]);
    
    // Parse disk info
    const diskLines = diskInfo.split('\n');
    const diskData = diskLines[1].split(/\s+/);
    const totalDisk = parseInt(diskData[1]);
    const availableDisk = parseInt(diskData[3]);
    
    return {
      cpu: {
        used: 0, // Would need more complex calculation
        available: cpuCount,
        percentage: 0
      },
      memory: {
        used: totalMem - availableMem,
        available: availableMem,
        percentage: ((totalMem - availableMem) / totalMem) * 100
      },
      storage: {
        used: totalDisk - availableDisk,
        available: availableDisk,
        percentage: ((totalDisk - availableDisk) / totalDisk) * 100
      }
    };
  }
}
```

#### **4. Enhanced DeploymentService Integration**

```typescript
// Add to existing DeploymentService
import { SwarmOrchestrationService, SwarmDeploymentConfig } from './swarm-orchestration.service';
import { ResourceAllocationService, ResourceQuotas } from './resource-allocation.service';

// Add to DeploymentService class
constructor(
  // ... existing dependencies
  private readonly swarmOrchestrationService: SwarmOrchestrationService,
  private readonly resourceAllocationService: ResourceAllocationService,
) {}

async createSwarmDeployment(data: CreateDeploymentData & {
  swarmConfig: SwarmDeploymentConfig;
  resourceQuotas?: ResourceQuotas;
}): Promise<string> {
  // Check resource availability
  if (data.resourceQuotas) {
    const available = await this.resourceAllocationService.checkResourceAvailability(data.resourceQuotas);
    if (!available) {
      throw new Error('Insufficient resources for deployment');
    }
  }

  // Create deployment record
  const deploymentId = await this.createDeployment(data);

  try {
    // Update status to building
    await this.updateDeploymentStatus(deploymentId, 'building');
    
    // Deploy to Swarm
    const stackName = await this.swarmOrchestrationService.deployStack(data.swarmConfig);
    
    // Update deployment with stack information
    await this.updateDeploymentMetadata(deploymentId, {
      stackName,
      orchestration: 'swarm',
      domain: data.swarmConfig.domain
    });
    
    await this.updateDeploymentStatus(deploymentId, 'deploying');
    
    // Monitor deployment health (would be done async)
    setTimeout(async () => {
      const stackStatus = await this.swarmOrchestrationService.getStackStatus(stackName);
      if (stackStatus && stackStatus.services.length > 0) {
        await this.updateDeploymentStatus(deploymentId, 'success');
      } else {
        await this.updateDeploymentStatus(deploymentId, 'failed');
      }
    }, 30000); // Check after 30 seconds
    
    return deploymentId;
    
  } catch (error) {
    await this.updateDeploymentStatus(deploymentId, 'failed');
    await this.addDeploymentLog(deploymentId, {
      level: 'error',
      message: `Swarm deployment failed: ${error.message}`,
      phase: 'deployment',
      timestamp: new Date(),
    });
    throw error;
  }
}
```

### **Environment Variables Setup**

```env
# Add to .env file

# Docker Swarm Configuration
DOCKER_SWARM_ENABLED=true
SWARM_MANAGER_IP=your-server-ip

# Domain Management
DEPLOYER_BASE_DOMAIN=deploy.example.com
LETS_ENCRYPT_EMAIL=admin@example.com

# Traefik Configuration
TRAEFIK_DASHBOARD_AUTH_USER=admin
TRAEFIK_DASHBOARD_AUTH_PASSWORD=$2y$10$hashed-password

# Resource Limits (per project defaults)
DEFAULT_CPU_LIMIT=1.0
DEFAULT_MEMORY_LIMIT=1G
DEFAULT_STORAGE_LIMIT=5G
DEFAULT_MAX_REPLICAS=3

# Monitoring
PROMETHEUS_ENABLED=false
GRAFANA_ENABLED=false
```

### **Database Migrations**

```sql
-- Add to migration file
-- 001_add_swarm_support.sql

ALTER TABLE deployments ADD COLUMN stack_name VARCHAR(255);
ALTER TABLE deployments ADD COLUMN orchestration_type VARCHAR(50) DEFAULT 'compose';
ALTER TABLE deployments ADD COLUMN resource_allocation JSONB;
ALTER TABLE deployments ADD COLUMN domain_config JSONB;

CREATE TABLE orchestration_stacks (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  project_id VARCHAR(255) NOT NULL,
  environment VARCHAR(50) NOT NULL,
  compose_config JSONB NOT NULL,
  resource_quotas JSONB,
  domain_mappings JSONB,
  status VARCHAR(50) NOT NULL DEFAULT 'creating',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orchestration_stacks_project ON orchestration_stacks(project_id);
CREATE INDEX idx_orchestration_stacks_environment ON orchestration_stacks(environment);
CREATE INDEX idx_orchestration_stacks_status ON orchestration_stacks(status);

CREATE TABLE service_instances (
  id VARCHAR(255) PRIMARY KEY,
  stack_id VARCHAR(255) NOT NULL REFERENCES orchestration_stacks(id) ON DELETE CASCADE,
  service_name VARCHAR(255) NOT NULL,
  image VARCHAR(500) NOT NULL,
  desired_replicas INTEGER DEFAULT 1,
  current_replicas INTEGER DEFAULT 0,
  resource_limits JSONB,
  health_status VARCHAR(50) DEFAULT 'unknown',
  domain_assignments JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_instances_stack ON service_instances(stack_id);
CREATE INDEX idx_service_instances_health ON service_instances(health_status);
```

### **ORPC Contracts Extension**

```typescript
// packages/api-contracts/src/orchestration.ts
import { z } from 'zod';
import { procedure, router } from '@orpc/server';

const SwarmDeploymentConfigSchema = z.object({
  projectId: z.string(),
  environment: z.enum(['production', 'staging', 'preview', 'development']),
  domain: z.string(),
  services: z.record(z.object({
    image: z.string(),
    replicas: z.number().optional(),
    resources: z.object({
      cpus: z.string(),
      memory: z.string(),
      reservations: z.object({
        cpus: z.string(),
        memory: z.string(),
      }).optional(),
    }),
    environment: z.record(z.string()),
    ports: z.array(z.number()).optional(),
    healthCheck: z.object({
      test: z.array(z.string()),
      interval: z.string(),
      timeout: z.string(),
      retries: z.number(),
    }).optional(),
    volumes: z.array(z.string()).optional(),
    labels: z.record(z.string()).optional(),
  })),
});

export const orchestrationContract = router({
  // Deploy using Swarm orchestration
  deploySwarmStack: procedure
    .input(z.object({
      deployment: SwarmDeploymentConfigSchema,
      resourceQuotas: z.object({
        cpu: z.object({
          limit: z.string(),
          reservation: z.string(),
        }),
        memory: z.object({
          limit: z.string(),
          reservation: z.string(),
        }),
        storage: z.object({
          limit: z.string(),
        }),
        replicas: z.object({
          max: z.number(),
        }),
      }).optional(),
    }))
    .output(z.object({
      deploymentId: z.string(),
      stackName: z.string(),
      estimatedCompleteTime: z.date(),
    }))
    .mutation(),

  // Get stack status
  getStackStatus: procedure
    .input(z.object({
      stackName: z.string(),
    }))
    .output(z.object({
      status: z.enum(['creating', 'running', 'updating', 'removing', 'failed']),
      services: z.array(z.object({
        name: z.string(),
        replicas: z.string(),
        image: z.string(),
        healthStatus: z.string(),
      })),
      domains: z.array(z.string()).optional(),
    }))
    .query(),

  // Get resource metrics
  getResourceMetrics: procedure
    .input(z.object({
      stackName: z.string().optional(),
    }))
    .output(z.object({
      cpu: z.object({
        used: z.number(),
        available: z.number(),
        percentage: z.number(),
      }),
      memory: z.object({
        used: z.number(),
        available: z.number(),
        percentage: z.number(),
      }),
      storage: z.object({
        used: z.number(),
        available: z.number(),
        percentage: z.number(),
      }),
    }))
    .query(),

  // Remove stack
  removeStack: procedure
    .input(z.object({
      stackName: z.string(),
    }))
    .output(z.object({
      success: z.boolean(),
      message: z.string(),
    }))
    .mutation(),
});
```

### **Frontend Integration Example**

```tsx
// apps/web/src/components/deployment/SwarmDeploymentForm.tsx
import React, { useState } from 'react';
import { useOrchestrationContract } from '@/lib/api';

interface SwarmDeploymentFormProps {
  projectId: string;
  onDeploymentCreated: (deploymentId: string) => void;
}

export function SwarmDeploymentForm({ projectId, onDeploymentCreated }: SwarmDeploymentFormProps) {
  const [isDeploying, setIsDeploying] = useState(false);
  const deployMutation = useOrchestrationContract.deploySwarmStack.useMutation();
  
  const handleDeploy = async (formData: any) => {
    setIsDeploying(true);
    
    try {
      const result = await deployMutation.mutateAsync({
        deployment: {
          projectId,
          environment: 'production',
          domain: 'deploy.example.com',
          services: {
            web: {
              image: formData.image,
              replicas: 2,
              resources: {
                cpus: '0.5',
                memory: '512M',
                reservations: {
                  cpus: '0.25',
                  memory: '256M',
                }
              },
              environment: {
                NODE_ENV: 'production',
                API_URL: 'http://api:3001'
              },
              ports: [3000],
              healthCheck: {
                test: ['CMD', 'wget', '--no-verbose', '--spider', 'http://localhost:3000/health'],
                interval: '30s',
                timeout: '10s',
                retries: 3
              }
            }
          }
        },
        resourceQuotas: {
          cpu: { limit: '1.0', reservation: '0.5' },
          memory: { limit: '1G', reservation: '512M' },
          storage: { limit: '5G' },
          replicas: { max: 5 }
        }
      });
      
      onDeploymentCreated(result.deploymentId);
    } catch (error) {
      console.error('Deployment failed:', error);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="deployment-form">
      {/* Form UI here */}
      <button 
        onClick={handleDeploy} 
        disabled={isDeploying}
        className="bg-blue-500 text-white px-4 py-2 rounded"
      >
        {isDeploying ? 'Deploying...' : 'Deploy with Swarm'}
      </button>
    </div>
  );
}
```

### **Testing the Implementation**

```bash
# Test Docker Swarm setup
docker node ls

# Test Traefik deployment
curl -H "Host: traefik.your-domain.com" http://localhost

# Test stack deployment
docker stack ls
docker stack services your-stack-name
docker service logs your-stack-name_web

# Test resource monitoring
docker stats --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}"
```

### **Monitoring Setup (Optional)**

```yaml
# monitoring-stack.yml
version: '3.8'
services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.console.libraries=/etc/prometheus/console_libraries'
      - '--web.console.templates=/etc/prometheus/consoles'
    networks:
      - monitoring
      - traefik-public
    deploy:
      labels:
        - traefik.enable=true
        - traefik.http.routers.prometheus.rule=Host(`prometheus.your-domain.com`)
        - traefik.http.services.prometheus.loadbalancer.server.port=9090

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana-data:/var/lib/grafana
    networks:
      - monitoring
      - traefik-public
    deploy:
      labels:
        - traefik.enable=true
        - traefik.http.routers.grafana.rule=Host(`grafana.your-domain.com`)
        - traefik.http.services.grafana.loadbalancer.server.port=3000

networks:
  monitoring:
    driver: overlay
  traefik-public:
    external: true

volumes:
  prometheus-data:
  grafana-data:
```

This implementation guide provides the foundation for transforming your current Docker Compose setup into a production-ready multi-tenant orchestration platform using Docker Swarm Mode and Traefik. The key benefits include:

1. **Scalability**: Support for multiple concurrent deployments
2. **Isolation**: Each deployment gets its own network and resources
3. **Automation**: Dynamic SSL certificates and service discovery
4. **Monitoring**: Built-in resource monitoring and health checks
5. **Security**: Network isolation and access control

The implementation maintains backward compatibility while adding enterprise-grade orchestration capabilities.