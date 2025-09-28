import type {
  DeploymentConfig,
  DeploymentProvider,
  BuildStrategy,
  SourceConfig,
  ResourceLimits,
  HealthCheckConfig,
  EnvironmentVariable,
  NetworkConfig,
  PreviewConfig
} from './deployment-config';

// Validation result interface
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// Provider-specific validation rules
export interface ProviderValidationRule {
  provider: DeploymentProvider;
  supportedBuildStrategies: BuildStrategy[];
  requiredEnvironmentVariables: string[];
  dockerfilePattern: RegExp;
  healthCheckRequired: boolean;
  supportsPreviewDeployments: boolean;
  supportsCustomDomains: boolean;
  maxResourceLimits: {
    memory?: string;
    cpu?: string;
    storage?: string;
    replicas?: number;
  };
}

// Default validation rules for each provider
export const PROVIDER_VALIDATION_RULES: Record<DeploymentProvider, ProviderValidationRule> = {
  'docker-compose-dev': {
    provider: 'docker-compose-dev',
    supportedBuildStrategies: ['development'],
    requiredEnvironmentVariables: ['NODE_ENV'],
    dockerfilePattern: /Dockerfile\..*\.dev$/,
    healthCheckRequired: false,
    supportsPreviewDeployments: true,
    supportsCustomDomains: false,
    maxResourceLimits: {
      memory: '4g',
      cpu: '4',
      storage: '50g',
      replicas: 1
    }
  },
  'docker-compose-prod-combined': {
    provider: 'docker-compose-prod-combined',
    supportedBuildStrategies: ['build-time', 'runtime'],
    requiredEnvironmentVariables: ['NODE_ENV'],
    dockerfilePattern: /Dockerfile\..*\.prod$/,
    healthCheckRequired: true,
    supportsPreviewDeployments: false,
    supportsCustomDomains: true,
    maxResourceLimits: {
      memory: '8g',
      cpu: '8',
      storage: '100g',
      replicas: 1
    }
  },
  'docker-compose-prod-separated': {
    provider: 'docker-compose-prod-separated',
    supportedBuildStrategies: ['build-time', 'runtime'],
    requiredEnvironmentVariables: ['NODE_ENV'],
    dockerfilePattern: /Dockerfile\..*\.prod$/,
    healthCheckRequired: true,
    supportsPreviewDeployments: false,
    supportsCustomDomains: true,
    maxResourceLimits: {
      memory: '16g',
      cpu: '16',
      storage: '500g',
      replicas: 1
    }
  },
  'docker-swarm': {
    provider: 'docker-swarm',
    supportedBuildStrategies: ['build-time'],
    requiredEnvironmentVariables: ['NODE_ENV'],
    dockerfilePattern: /Dockerfile\..*\.prod$/,
    healthCheckRequired: true,
    supportsPreviewDeployments: false,
    supportsCustomDomains: true,
    maxResourceLimits: {
      memory: '32g',
      cpu: '32',
      storage: '1000g',
      replicas: 50
    }
  },
  'render': {
    provider: 'render',
    supportedBuildStrategies: ['build-time'],
    requiredEnvironmentVariables: ['NODE_ENV', 'RENDER_EXTERNAL_URL'],
    dockerfilePattern: /Dockerfile\..*\.build-time\.prod$/,
    healthCheckRequired: true,
    supportsPreviewDeployments: true,
    supportsCustomDomains: true,
    maxResourceLimits: {
      memory: '4g',
      cpu: '2',
      storage: '20g',
      replicas: 10
    }
  },
  'vercel': {
    provider: 'vercel',
    supportedBuildStrategies: ['build-time'],
    requiredEnvironmentVariables: ['NODE_ENV', 'VERCEL_URL'],
    dockerfilePattern: /next\.config\.(js|ts)$/,
    healthCheckRequired: false,
    supportsPreviewDeployments: true,
    supportsCustomDomains: true,
    maxResourceLimits: {
      memory: '1g',
      cpu: '1',
      storage: '10g',
      replicas: 1
    }
  },
  'railway': {
    provider: 'railway',
    supportedBuildStrategies: ['build-time', 'runtime'],
    requiredEnvironmentVariables: ['NODE_ENV'],
    dockerfilePattern: /Dockerfile\..*\.prod$/,
    healthCheckRequired: false,
    supportsPreviewDeployments: true,
    supportsCustomDomains: true,
    maxResourceLimits: {
      memory: '8g',
      cpu: '8',
      storage: '100g',
      replicas: 1
    }
  },
  'fly-io': {
    provider: 'fly-io',
    supportedBuildStrategies: ['build-time'],
    requiredEnvironmentVariables: ['NODE_ENV'],
    dockerfilePattern: /Dockerfile\..*\.prod$/,
    healthCheckRequired: true,
    supportsPreviewDeployments: false,
    supportsCustomDomains: true,
    maxResourceLimits: {
      memory: '2g',
      cpu: '2',
      storage: '50g',
      replicas: 10
    }
  },
  'custom': {
    provider: 'custom',
    supportedBuildStrategies: ['development', 'build-time', 'runtime'],
    requiredEnvironmentVariables: [],
    dockerfilePattern: /Dockerfile/,
    healthCheckRequired: false,
    supportsPreviewDeployments: true,
    supportsCustomDomains: true,
    maxResourceLimits: {
      memory: '1000g',
      cpu: '1000',
      storage: '10000g',
      replicas: 1000
    }
  }
};

// Validation functions
export class DeploymentConfigValidator {
  /**
   * Validates a complete deployment configuration
   */
  static validate(config: DeploymentConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic structure validation
    const basicValidation = this.validateBasicStructure(config);
    errors.push(...basicValidation.errors);
    warnings.push(...basicValidation.warnings);

    // Provider-specific validation
    const providerValidation = this.validateProvider(config);
    errors.push(...providerValidation.errors);
    warnings.push(...providerValidation.warnings);

    // Source configuration validation
    const sourceValidation = this.validateSourceConfig(config.sourceConfig);
    errors.push(...sourceValidation.errors);
    warnings.push(...sourceValidation.warnings);

    // Resource limits validation
    const resourceValidation = this.validateResourceLimits(config.resourceLimits, config.provider);
    errors.push(...resourceValidation.errors);
    warnings.push(...resourceValidation.warnings);

    // Health check validation
    const healthValidation = this.validateHealthCheck(config.healthCheck);
    errors.push(...healthValidation.errors);
    warnings.push(...healthValidation.warnings);

    // Environment variables validation
    const envValidation = this.validateEnvironmentVariables(config.environmentVariables, config.provider);
    errors.push(...envValidation.errors);
    warnings.push(...envValidation.warnings);

    // Network configuration validation
    const networkValidation = this.validateNetworkConfig(config.networkConfig);
    errors.push(...networkValidation.errors);
    warnings.push(...networkValidation.warnings);

    // Preview configuration validation
    if (config.previewConfig) {
      const previewValidation = this.validatePreviewConfig(config.previewConfig, config.provider);
      errors.push(...previewValidation.errors);
      warnings.push(...previewValidation.warnings);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validates basic deployment configuration structure
   */
  static validateBasicStructure(config: DeploymentConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!config.serviceId) {
      errors.push('Service ID is required');
    }

    if (!config.projectId) {
      errors.push('Project ID is required');
    }

    // UUID validation
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
    if (config.serviceId && !uuidPattern.test(config.serviceId)) {
      errors.push('Service ID must be a valid UUID');
    }

    if (config.projectId && !uuidPattern.test(config.projectId)) {
      errors.push('Project ID must be a valid UUID');
    }

    if (config.deploymentId && !uuidPattern.test(config.deploymentId)) {
      errors.push('Deployment ID must be a valid UUID');
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validates provider-specific requirements
   */
  static validateProvider(config: DeploymentConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const rule = PROVIDER_VALIDATION_RULES[config.provider];
    if (!rule) {
      errors.push(`Unknown provider: ${config.provider}`);
      return { isValid: false, errors, warnings };
    }

    // Build strategy validation
    if (!rule.supportedBuildStrategies.includes(config.buildStrategy)) {
      errors.push(
        `Build strategy '${config.buildStrategy}' is not supported by provider '${config.provider}'. ` +
        `Supported strategies: ${rule.supportedBuildStrategies.join(', ')}`
      );
    }

    // Dockerfile pattern validation
    if (config.buildConfig.dockerfilePath && !rule.dockerfilePattern.test(config.buildConfig.dockerfilePath)) {
      warnings.push(
        `Dockerfile path '${config.buildConfig.dockerfilePath}' does not match expected pattern for provider '${config.provider}'`
      );
    }

    // Health check requirement
    if (rule.healthCheckRequired && !config.healthCheck.enabled) {
      errors.push(`Health checks are required for provider '${config.provider}'`);
    }

    // Preview deployment support
    if (config.previewConfig?.enabled && !rule.supportsPreviewDeployments) {
      errors.push(`Preview deployments are not supported by provider '${config.provider}'`);
    }

    // Custom domain support
    if (config.networkConfig.customDomain && !rule.supportsCustomDomains) {
      warnings.push(`Custom domains may not be supported by provider '${config.provider}'`);
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validates source configuration
   */
  static validateSourceConfig(sourceConfig: SourceConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    switch (sourceConfig.type) {
      case 'github':
      case 'gitlab':
      case 'git':
        if (!sourceConfig.repositoryUrl) {
          errors.push('Repository URL is required for Git-based sources');
        } else {
          try {
            new URL(sourceConfig.repositoryUrl);
          } catch {
            errors.push('Repository URL must be a valid URL');
          }
        }
        if (!sourceConfig.branch) {
          warnings.push('No branch specified, will default to main/master');
        }
        break;

      case 'upload':
        if (!sourceConfig.fileName) {
          errors.push('File name is required for upload sources');
        }
        if (!sourceConfig.fileSize || sourceConfig.fileSize <= 0) {
          errors.push('File size must be greater than 0 for upload sources');
        }
        break;

      case 'docker-image':
        if (!sourceConfig.imageName) {
          errors.push('Image name is required for Docker image sources');
        }
        if (!sourceConfig.imageTag) {
          warnings.push('No image tag specified, will default to latest');
        }
        break;

      case 'custom':
        if (!sourceConfig.customData || Object.keys(sourceConfig.customData).length === 0) {
          warnings.push('Custom source has no configuration data');
        }
        break;

      default:
        errors.push(`Unknown source type: ${sourceConfig.type}`);
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validates resource limits
   */
  static validateResourceLimits(resourceLimits: ResourceLimits, provider: DeploymentProvider): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const rule = PROVIDER_VALIDATION_RULES[provider];
    const maxLimits = rule.maxResourceLimits;

    // Memory validation
    if (resourceLimits.memory) {
      if (!this.isValidMemoryFormat(resourceLimits.memory)) {
        errors.push('Memory limit must be in format like "512m", "1g", "2G"');
      } else if (maxLimits.memory && this.parseMemory(resourceLimits.memory) > this.parseMemory(maxLimits.memory)) {
        errors.push(`Memory limit exceeds maximum for provider ${provider}: ${maxLimits.memory}`);
      }
    }

    // CPU validation
    if (resourceLimits.cpu) {
      const cpuValue = parseFloat(resourceLimits.cpu);
      if (isNaN(cpuValue) || cpuValue <= 0) {
        errors.push('CPU limit must be a positive number');
      } else if (maxLimits.cpu && cpuValue > parseFloat(maxLimits.cpu)) {
        errors.push(`CPU limit exceeds maximum for provider ${provider}: ${maxLimits.cpu}`);
      }
    }

    // Storage validation
    if (resourceLimits.storage) {
      if (!this.isValidStorageFormat(resourceLimits.storage)) {
        errors.push('Storage limit must be in format like "1g", "10G", "100gb"');
      } else if (maxLimits.storage && this.parseStorage(resourceLimits.storage) > this.parseStorage(maxLimits.storage)) {
        errors.push(`Storage limit exceeds maximum for provider ${provider}: ${maxLimits.storage}`);
      }
    }

    // Replicas validation
    if (resourceLimits.replicas) {
      if (resourceLimits.replicas <= 0 || !Number.isInteger(resourceLimits.replicas)) {
        errors.push('Replicas must be a positive integer');
      } else if (maxLimits.replicas && resourceLimits.replicas > maxLimits.replicas) {
        errors.push(`Replicas count exceeds maximum for provider ${provider}: ${maxLimits.replicas}`);
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validates health check configuration
   */
  static validateHealthCheck(healthCheck: HealthCheckConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (healthCheck.enabled) {
      if (!healthCheck.path) {
        errors.push('Health check path is required when health checks are enabled');
      } else if (!healthCheck.path.startsWith('/')) {
        errors.push('Health check path must start with "/"');
      }

      if (healthCheck.intervalSeconds <= 0) {
        errors.push('Health check interval must be greater than 0');
      } else if (healthCheck.intervalSeconds < 10) {
        warnings.push('Health check interval less than 10 seconds may cause performance issues');
      }

      if (healthCheck.timeoutSeconds <= 0) {
        errors.push('Health check timeout must be greater than 0');
      } else if (healthCheck.timeoutSeconds >= healthCheck.intervalSeconds) {
        errors.push('Health check timeout must be less than interval');
      }

      if (healthCheck.startPeriodSeconds < 0) {
        errors.push('Health check start period cannot be negative');
      }

      if (healthCheck.retries <= 0) {
        errors.push('Health check retries must be greater than 0');
      } else if (healthCheck.retries > 10) {
        warnings.push('High retry count may delay failure detection');
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validates environment variables
   */
  static validateEnvironmentVariables(
    envVars: EnvironmentVariable[], 
    provider: DeploymentProvider
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const rule = PROVIDER_VALIDATION_RULES[provider];
    const keys = new Set<string>();

    // Check for required environment variables
    const providedKeys = envVars.map(ev => ev.key);
    for (const requiredKey of rule.requiredEnvironmentVariables) {
      if (!providedKeys.includes(requiredKey)) {
        errors.push(`Required environment variable missing: ${requiredKey}`);
      }
    }

    // Validate individual variables
    for (const envVar of envVars) {
      if (!envVar.key) {
        errors.push('Environment variable key cannot be empty');
        continue;
      }

      // Check for duplicates
      if (keys.has(envVar.key)) {
        errors.push(`Duplicate environment variable key: ${envVar.key}`);
      }
      keys.add(envVar.key);

      // Key format validation
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(envVar.key)) {
        warnings.push(`Environment variable key '${envVar.key}' should follow naming conventions (letters, numbers, underscores)`);
      }

      // Secret variable validation
      if (envVar.isSecret && !envVar.value) {
        warnings.push(`Secret environment variable '${envVar.key}' has no value`);
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validates network configuration
   */
  static validateNetworkConfig(networkConfig: NetworkConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Port validation
    for (const port of networkConfig.ports) {
      if (port < 1 || port > 65535) {
        errors.push(`Invalid port number: ${port}. Must be between 1 and 65535`);
      } else if (port < 1024 && port !== 80 && port !== 443) {
        warnings.push(`Port ${port} is a privileged port and may require special permissions`);
      }
    }

    // Subdomain validation
    if (networkConfig.subdomain) {
      if (!/^[a-z0-9-]+$/.test(networkConfig.subdomain)) {
        errors.push('Subdomain must contain only lowercase letters, numbers, and hyphens');
      } else if (networkConfig.subdomain.startsWith('-') || networkConfig.subdomain.endsWith('-')) {
        errors.push('Subdomain cannot start or end with a hyphen');
      }
    }

    // Custom domain validation
    if (networkConfig.customDomain) {
      const domainPattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
      if (!domainPattern.test(networkConfig.customDomain)) {
        errors.push('Custom domain format is invalid');
      }
    }

    // CORS origins validation
    if (networkConfig.allowedOrigins) {
      for (const origin of networkConfig.allowedOrigins) {
        if (origin !== '*') {
          try {
            new URL(origin);
          } catch {
            errors.push(`Invalid CORS origin: ${origin}`);
          }
        }
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validates preview configuration
   */
  static validatePreviewConfig(previewConfig: PreviewConfig, provider: DeploymentProvider): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const rule = PROVIDER_VALIDATION_RULES[provider];

    if (!rule.supportsPreviewDeployments) {
      errors.push(`Preview deployments are not supported by provider '${provider}'`);
      return { isValid: false, errors, warnings };
    }

    if (!previewConfig.baseDomain) {
      errors.push('Base domain is required for preview deployments');
    } else {
      const domainPattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
      if (!domainPattern.test(previewConfig.baseDomain)) {
        errors.push('Base domain format is invalid');
      }
    }

    if (previewConfig.customDomain) {
      const domainPattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
      if (!domainPattern.test(previewConfig.customDomain)) {
        errors.push('Custom domain format is invalid');
      }
    }

    if (previewConfig.retentionDays && (previewConfig.retentionDays < 1 || previewConfig.retentionDays > 365)) {
      errors.push('Preview retention days must be between 1 and 365');
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  // Helper methods
  private static isValidMemoryFormat(memory: string): boolean {
    return /^\d+[mMgGtT]$/.test(memory);
  }

  private static isValidStorageFormat(storage: string): boolean {
    return /^\d+[mMgGtT][bB]?$/.test(storage);
  }

  private static parseMemory(memory: string): number {
    const value = parseInt(memory);
    const unit = memory.slice(-1).toLowerCase();
    
    switch (unit) {
      case 'm': return value;
      case 'g': return value * 1024;
      case 't': return value * 1024 * 1024;
      default: return value;
    }
  }

  private static parseStorage(storage: string): number {
    const value = parseInt(storage);
    const unit = storage.replace(/\d+/, '').toLowerCase();
    
    switch (unit) {
      case 'm':
      case 'mb': return value;
      case 'g':
      case 'gb': return value * 1024;
      case 't':
      case 'tb': return value * 1024 * 1024;
      default: return value;
    }
  }
}

// Utility functions for common validation scenarios
export const validateDeploymentConfig = (config: DeploymentConfig): ValidationResult => {
  return DeploymentConfigValidator.validate(config);
};

export const validateForProvider = (config: DeploymentConfig, provider: DeploymentProvider): ValidationResult => {
  const updatedConfig = { ...config, provider };
  return DeploymentConfigValidator.validate(updatedConfig);
};

export const getProviderLimitations = (provider: DeploymentProvider): ProviderValidationRule => {
  return PROVIDER_VALIDATION_RULES[provider];
};