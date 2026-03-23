# DockerService API Reference

> **Last Updated**: 2025-11-30

## Container Lifecycle Operations

### createContainer

Creates a Docker container without starting it.

```typescript
async createContainer(options: CreateContainerOptions): Promise<Docker.Container>
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `options` | `CreateContainerOptions` | ✓ | Container creation options |

**CreateContainerOptions extends Docker.ContainerCreateOptions:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `Image` | `string` | - | Docker image to use |
| `image` | `string` | - | Alternative (lowercase) image field |
| `name` | `string` | - | Container name |
| `imagePullPolicy` | `'IfNotPresent' \| 'Always' \| 'Never'` | `'IfNotPresent'` | When to pull image |
| `registryAuth` | `Docker.AuthConfig` | - | Registry authentication |

**Returns:** `Promise<Docker.Container>` - The created container object

**Example:**
```typescript
const container = await dockerService.createContainer({
  Image: 'nginx:alpine',
  name: 'my-nginx',
  Labels: {
    'deployer.deployment_id': 'deploy-123',
    'deployer.managed': 'true',
  },
  HostConfig: {
    PortBindings: {
      '80/tcp': [{ HostPort: '8080' }],
    },
  },
});
```

---

### createAndStartContainer

Creates and immediately starts a container with labeled deployment tracking.

```typescript
async createAndStartContainer(options: {
  image: string;
  name: string;
  deploymentId: string;
  envVars?: Record<string, string>;
  ports?: Record<string, string>;
  imagePullPolicy?: 'IfNotPresent' | 'Always' | 'Never';
  registryAuth?: Docker.AuthConfig;
}): Promise<string>
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `options.image` | `string` | ✓ | Docker image to use |
| `options.name` | `string` | ✓ | Container name |
| `options.deploymentId` | `string` | ✓ | Deployment ID for tracking |
| `options.envVars` | `Record<string, string>` | - | Environment variables |
| `options.ports` | `Record<string, string>` | - | Port mappings (container → host) |
| `options.imagePullPolicy` | `'IfNotPresent' \| 'Always' \| 'Never'` | `'IfNotPresent'` | Pull policy |
| `options.registryAuth` | `Docker.AuthConfig` | - | Registry authentication |

**Returns:** `Promise<string>` - Container ID

**Example:**
```typescript
const containerId = await dockerService.createAndStartContainer({
  image: 'node:18-alpine',
  name: 'my-app',
  deploymentId: 'deploy-456',
  envVars: {
    NODE_ENV: 'production',
    PORT: '3000',
  },
  ports: {
    '3000': '3000',
  },
});
```

---

### stopContainer

Stops a running container.

```typescript
async stopContainer(containerIdOrName: string): Promise<void>
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `containerIdOrName` | `string` | ✓ | Container ID or name |

**Example:**
```typescript
await dockerService.stopContainer('my-container');
```

---

### stopContainersByDeployment

Stops all containers belonging to a deployment.

```typescript
async stopContainersByDeployment(deploymentId: string): Promise<void>
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `deploymentId` | `string` | ✓ | Deployment ID |

**Example:**
```typescript
await dockerService.stopContainersByDeployment('deploy-123');
```

---

### startContainersByDeployment

Starts all containers belonging to a deployment.

```typescript
async startContainersByDeployment(deploymentId: string): Promise<void>
```

---

### restartContainer

Restarts a container.

```typescript
async restartContainer(containerId: string): Promise<void>
```

---

### removeContainer

Stops (if running) and removes a container.

```typescript
async removeContainer(containerId: string): Promise<void>
```

**Behavior:**
- Stops container if running (10 second timeout)
- Removes container with force
- Removes associated volumes
- Ignores "container not found" errors

---

## Container Information

### getContainerInfo

Gets detailed information about a container.

```typescript
async getContainerInfo(containerIdOrName: string): Promise<Docker.ContainerInspectInfo>
```

**Returns:** Full container inspection data including:
- `Id`: Container ID
- `Name`: Container name
- `State`: Current state (running, stopped, etc.)
- `Config`: Container configuration
- `NetworkSettings`: Network information
- `Mounts`: Volume mounts

---

### listContainers

Lists containers with optional filtering.

```typescript
async listContainers(options?: Docker.ContainerListOptions): Promise<Docker.ContainerInfo[]>
```

**Example:**
```typescript
// List all running containers
const containers = await dockerService.listContainers({ all: false });

// List all containers (including stopped)
const allContainers = await dockerService.listContainers({ all: true });

// List with filter
const deployerContainers = await dockerService.listContainers({
  filters: { label: ['deployer.managed=true'] },
});
```

---

### listContainersByDeployment

Lists containers belonging to a specific deployment.

```typescript
async listContainersByDeployment(deploymentId: string): Promise<Array<{
  id: string;
  name: string;
  status: string;
}>>
```

---

### getContainerLogs

Gets container logs.

```typescript
async getContainerLogs(
  containerIdOrName: string, 
  options?: {
    stdout?: boolean;
    stderr?: boolean;
    tail?: number;
  }
): Promise<string>
```

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `options.stdout` | `boolean` | `true` | Include stdout |
| `options.stderr` | `boolean` | `true` | Include stderr |
| `options.tail` | `number` | `200` | Number of lines from end |

---

### getContainerStats

Gets container resource statistics.

```typescript
async getContainerStats(containerId: string): Promise<Record<string, any>>
```

**Returns:** Docker stats including CPU, memory, network I/O

---

## Container Execution

### execInContainer

Executes a command inside a running container.

```typescript
async execInContainer(
  containerIdOrName: string,
  cmd: string[],
  input?: string
): Promise<{ exitCode: number; output: string }>
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `containerIdOrName` | `string` | ✓ | Container ID or name |
| `cmd` | `string[]` | ✓ | Command and arguments |
| `input` | `string` | - | Optional stdin input |

**Example:**
```typescript
const result = await dockerService.execInContainer(
  'my-container',
  ['sh', '-c', 'ls -la /app']
);
console.log(result.output);
```

**Error Handling:**
- Throws on non-zero exit code
- Handles HTTP 101 (protocol upgrade) with fallback
- Supports both hijack and non-hijack modes

---

### runCommandInHelperContainer

Runs a command in a temporary helper container with the same volumes as the target container.

```typescript
async runCommandInHelperContainer(
  containerIdOrName: string,
  command: string,
  input?: string
): Promise<{ exitCode: number; output: string }>
```

**Use Case:** Fallback when exec fails due to protocol issues.

---

## Image Operations

### buildImage

Builds a Docker image from source.

```typescript
async buildImage(sourcePath: string, imageTag: string): Promise<void>
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `sourcePath` | `string` | ✓ | Path to build context |
| `imageTag` | `string` | ✓ | Tag for the built image |

**Behavior:**
- Creates basic Dockerfile if none exists (Node.js default)
- Streams build output to logger
- Throws on build failure

---

### pullImage

Pulls an image from a registry.

```typescript
async pullImage(
  image: string,
  registryAuth?: Docker.AuthConfig,
  retries?: number,
  backoffMs?: number
): Promise<void>
```

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `image` | `string` | - | Image reference |
| `registryAuth` | `Docker.AuthConfig` | - | Authentication |
| `retries` | `number` | `3` | Retry attempts |
| `backoffMs` | `number` | `2000` | Initial backoff (exponential) |

**Example:**
```typescript
// Public image
await dockerService.pullImage('nginx:alpine');

// Private registry
await dockerService.pullImage('my-registry.com/app:latest', {
  username: 'user',
  password: 'pass',
  serveraddress: 'my-registry.com',
});
```

---

### removeImage

Removes a Docker image.

```typescript
async removeImage(imageTag: string): Promise<void>
```

---

## Health Monitoring

### checkContainerHealth

Simple health check - is container running and healthy?

```typescript
async checkContainerHealth(containerId: string): Promise<boolean>
```

**Returns:** `true` if running and healthy (or no healthcheck configured)

---

### getDetailedContainerHealth

Gets comprehensive health information.

```typescript
async getDetailedContainerHealth(containerId: string): Promise<{
  isHealthy: boolean;
  status: string;
  uptime: number;
  restartCount: number;
  lastStarted: Date | null;
  healthChecks?: {
    status: string;
    failingStreak: number;
    log: Array<{
      start: string;
      end: string;
      exitCode: number;
      output: string;
    }>;
  };
  resources: {
    cpuUsage?: number;
    memoryUsage?: number;
    memoryLimit?: number;
  };
}>
```

---

### performHealthCheck

Performs health check with optional HTTP endpoint verification.

```typescript
async performHealthCheck(
  containerId: string,
  healthCheckUrl?: string,
  timeout?: number
): Promise<{
  isHealthy: boolean;
  httpStatus?: number;
  responseTime?: number;
  error?: string;
  containerHealth: DetailedHealth;
}>
```

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `containerId` | `string` | - | Container to check |
| `healthCheckUrl` | `string` | - | Optional HTTP endpoint |
| `timeout` | `number` | `30000` | HTTP request timeout (ms) |

---

### waitForContainerHealth

Waits for a container to become healthy with retries.

```typescript
async waitForContainerHealth(
  containerId: string,
  maxRetries?: number,
  retryInterval?: number,
  healthCheckUrl?: string
): Promise<boolean>
```

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `containerId` | `string` | - | Container to monitor |
| `maxRetries` | `number` | `30` | Max retry attempts |
| `retryInterval` | `number` | `2000` | Interval between retries (ms) |
| `healthCheckUrl` | `string` | - | Optional HTTP endpoint |

---

### monitorContainersByDeployment

Gets health status for all containers in a deployment.

```typescript
async monitorContainersByDeployment(deploymentId: string): Promise<Array<{
  containerId: string;
  containerName: string;
  health: DetailedHealth;
}>>
```

---

## Volume Operations

### putStringIntoVolume

Writes a string as a file into a Docker volume.

```typescript
async putStringIntoVolume(
  volumeName: string,
  destPathInVolume: string,
  filename: string,
  content: string,
  retries?: number,
  backoffMs?: number
): Promise<void>
```

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `volumeName` | `string` | - | Target volume name |
| `destPathInVolume` | `string` | - | Path within volume |
| `filename` | `string` | - | File name to create |
| `content` | `string` | - | File content |
| `retries` | `number` | `3` | Retry attempts |
| `backoffMs` | `number` | `1000` | Initial backoff |

**Implementation:**
- Uses base64 encoding for safe transfer
- Creates helper container with volume mounted
- Sets ownership to 1000:1000

**Example:**
```typescript
await dockerService.putStringIntoVolume(
  'my-volume',
  '/config',
  'app.json',
  JSON.stringify({ key: 'value' })
);
```

---

### copyFromContainerToVolume

Copies files from a container to a volume.

```typescript
async copyFromContainerToVolume(
  sourceContainerIdOrName: string,
  sourcePath: string,
  volumeName: string,
  destPathInVolume: string
): Promise<void>
```

**Implementation:**
1. Creates helper container with volume mounted
2. Uses `container.getArchive()` to get tar stream from source
3. Writes tar to temp file
4. Extracts into volume using helper container
5. Sets permissions (644 files, 755 dirs)
6. Sets ownership (100:101 for lighttpd)

---

### runCommandInVolume

Runs a command in a temporary container with a volume mounted.

```typescript
async runCommandInVolume(
  volumeName: string,
  command: string,
  input?: string
): Promise<{ exitCode: number; output: string }>
```

**Example:**
```typescript
const result = await dockerService.runCommandInVolume(
  'my-volume',
  'ls -la /target'
);
```

---

### findContainerWithPath

Finds a container that contains a specific path.

```typescript
async findContainerWithPath(searchPath: string): Promise<string | null>
```

**Use Case:** Finding which container has a specific file/directory.

---

## Utility Methods

### getDockerClient

Gets the raw dockerode client for advanced operations.

```typescript
getDockerClient(): Docker
```

**Warning:** Use with caution. Prefer DockerService methods.

---

### testConnection

Tests Docker daemon connectivity.

```typescript
async testConnection(): Promise<boolean>
```

---

### getSelfContainerId

Attempts to detect the container ID of the current process.

```typescript
getSelfContainerId(): string | null
```

**Implementation:**
- Tries `/proc/self/cgroup`
- Falls back to `/etc/hostname`
