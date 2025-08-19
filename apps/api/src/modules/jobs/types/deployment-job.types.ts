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
    buildCommand?: string;
    startCommand?: string;
    envVars?: Record<string, string>;
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