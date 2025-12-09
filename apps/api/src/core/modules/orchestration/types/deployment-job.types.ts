export interface DeploymentJobData {
    deploymentId: string;
    projectId: string;
    serviceId: string;
    sourceConfig: {
        type: 'github' | 'gitlab' | 'git' | 'upload';
        repositoryUrl?: string;
        branch?: string;
        commitSha?: string;
        filePath?: string;
        fileName?: string;
        fileSize?: number;
        buildCommand?: string;
        startCommand?: string;
        envVars?: Record<string, string>;
        // Custom data for uploads or embedded content (e.g. seeded static files)
        customData?: Record<string, any>;
        // Optional image override to use when creating runtime containers (e.g. for static sites)
        image?: string;
        // Image pull policy controls whether to always pull, only if not present, or never pull
        imagePullPolicy?: 'IfNotPresent' | 'Always' | 'Never';
        // Optional registry authentication to use when pulling private images
        registryAuth?: {
            username?: string;
            password?: string;
            serveraddress?: string;
            identity?: string;
            registrytoken?: string;
        };
    };
}
export interface DeploymentJobResult {
    success: boolean;
    deploymentId: string;
    containerId?: string;
    imageTag?: string;
    domainUrl?: string;
    error?: string;
    message: string;
}
export interface RollbackJobData {
    deploymentId: string;
    targetDeploymentId: string;
}
export interface HealthCheckJobData {
    deploymentId: string;
    containerId: string;
}
export interface CleanupJobData {
    deploymentId: string;
    type: 'container' | 'image' | 'volume' | 'all';
}

// Swarm orchestration types (previously from @repo/api-contracts)
export interface SwarmStackConfig {
    name: string;
    projectId: string;
    environment: string;
    composeConfig: Record<string, unknown>;
    domain?: string;
    services?: Record<string, SwarmServiceConfig>;
    networks?: Record<string, SwarmNetworkConfig>;
    volumes?: Record<string, SwarmVolumeConfig>;
    configs?: Record<string, SwarmConfigConfig>;
    secrets?: Record<string, SwarmSecretConfig>;
}

export interface SwarmServiceConfig {
    image: string;
    replicas?: number;
    environment?: Record<string, string>;
    ports?: string[];
    volumes?: string[];
    networks?: string[];
    deploy?: {
        mode?: 'replicated' | 'global';
        replicas?: number;
        resources?: {
            limits?: { cpus?: string; memory?: string };
            reservations?: { cpus?: string; memory?: string };
        };
        labels?: Record<string, string>;
        update_config?: {
            parallelism?: number;
            delay?: string;
            failure_action?: 'pause' | 'continue' | 'rollback';
        };
        rollback_config?: {
            parallelism?: number;
            delay?: string;
        };
    };
    labels?: Record<string, string>;
    healthcheck?: {
        test?: string | string[];
        interval?: string;
        timeout?: string;
        retries?: number;
        start_period?: string;
    };
}

export interface SwarmNetworkConfig {
    driver?: string;
    external?: boolean;
    driver_opts?: Record<string, string>;
    labels?: Record<string, string>;
}

export interface SwarmVolumeConfig {
    driver?: string;
    external?: boolean;
    driver_opts?: Record<string, string>;
    labels?: Record<string, string>;
}

export interface SwarmConfigConfig {
    file?: string;
    external?: boolean;
}

export interface SwarmSecretConfig {
    file?: string;
    external?: boolean;
}

export interface StackStatus {
    id: string;
    name: string;
    projectId?: string;
    environment?: string;
    status: 'pending' | 'deploying' | 'running' | 'failed' | 'removing' | 'updating' | 'stopped' | 'error';
    services: ServiceStatus[];
    createdAt: Date;
    updatedAt: Date;
    resourceUsage?: ResourceUsage;
}

export interface ServiceStatus {
    name: string;
    replicas: { desired: number; current: number; updated: number };
    runningReplicas?: number;
    status: 'running' | 'pending' | 'failed' | 'updating' | string;
    ports?: number[];
    endpoints?: string[];
}

// Resource allocation types (previously from @repo/api-contracts)
export interface ResourceUsage {
    cpu: { allocated: number; used: number; percentage: number };
    memory: { allocated: number; used: number; percentage: number };
    storage: { allocated: number; used: number; percentage: number };
    replicas: { total: number; running: number };
    services: number;
}
