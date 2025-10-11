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
