import { Injectable } from '@nestjs/common';
import { TraefikConfigBuilder } from '../config-builder/builders';

/**
 * Available variables for Traefik configuration templates
 * 
 * These variables are used in service Traefik configs and resolved during sync
 */
export const TRAEFIK_VARIABLES = {
  // Service-level variables
  SERVICE_NAME: '~##serviceName##~',
  SERVICE_ID: '~##serviceId##~',
  SERVICE_TYPE: '~##serviceType##~',
  
  // Deployment-level variables
  DEPLOYMENT_ID: '~##deploymentId##~',
  CONTAINER_NAME: '~##containerName##~',
  CONTAINER_PORT: '~##containerPort##~',
  CONTAINER_ID: '~##containerId##~',
  
  // Domain variables
  DOMAIN: '~##domain##~',
  SUBDOMAIN: '~##subdomain##~',
  FULL_DOMAIN: '~##fullDomain##~',
  BASE_DOMAIN: '~##baseDomain##~',
  
  // SSL/TLS variables
  CERT_FILE: '~##certFile##~',
  KEY_FILE: '~##keyFile##~',
  CERT_RESOLVER: '~##certResolver##~',
  
  // Path variables
  PATH_PREFIX: '~##pathPrefix##~',
  HEALTH_CHECK_PATH: '~##healthCheckPath##~',
  
  // Network variables
  NETWORK_NAME: '~##networkName##~',
  NETWORK_ID: '~##networkId##~',
  
  // Environment variables
  ENVIRONMENT: '~##environment##~',
  PROJECT_ID: '~##projectId##~',
  PROJECT_NAME: '~##projectName##~',
  
  // Route variables
  ROUTER_NAME: '~##routerName##~',
  SERVICE_NAME_TRAEFIK: '~##traefikServiceName##~',
  MIDDLEWARE_NAME: '~##middlewareName##~',
  
  // Advanced variables
  ENTRY_POINT: '~##entryPoint##~',
  PRIORITY: '~##priority##~',
  LOAD_BALANCER_ALGORITHM: '~##lbAlgorithm##~',
} as const;

/**
 * Context data for variable resolution
 */
export interface VariableResolutionContext {
  // Service context
  service?: {
    id: string;
    name: string;
    type: string;
    port?: number;
    healthCheckPath?: string;
  };
  
  // Deployment context
  deployment?: {
    id: string;
    containerName: string;
    containerPort: number;
    containerId?: string;
    environment: string;
  };
  
  // Domain context
  domain?: {
    domain: string;
    subdomain?: string;
    fullDomain: string;
    baseDomain?: string;
  };
  
  // SSL context
  ssl?: {
    certFile?: string;
    keyFile?: string;
    certResolver?: string;
  };
  
  // Path context
  path?: {
    prefix?: string;
    healthCheck?: string;
  };
  
  // Network context
  network?: {
    name: string;
    id?: string;
  };
  
  // Project context
  project?: {
    id: string;
    name: string;
  };
  
  // Route context
  route?: {
    routerName?: string;
    serviceName?: string;
    middlewareName?: string;
    entryPoint?: string;
    priority?: number;
  };
  
  // Custom variables
  custom?: Record<string, string | number | boolean>;
}

/**
 * Service for resolving variables in Traefik configurations
 */
@Injectable()
export class TraefikVariableResolverService {
  /**
   * Get all available variables as an object
   */
  getAvailableVariables(): typeof TRAEFIK_VARIABLES {
    return TRAEFIK_VARIABLES;
  }

  /**
   * Get all variable names as an array
   */
  getVariableNames(): string[] {
    return Object.values(TRAEFIK_VARIABLES);
  }

  /**
   * Build variable map from context
   */
  buildVariableMap(context: VariableResolutionContext): Record<string, string> {
    const variables: Record<string, string> = {};

    // Service variables
    if (context.service) {
      variables[TRAEFIK_VARIABLES.SERVICE_NAME] = context.service.name;
      variables[TRAEFIK_VARIABLES.SERVICE_ID] = context.service.id;
      variables[TRAEFIK_VARIABLES.SERVICE_TYPE] = context.service.type;
      if (context.service.healthCheckPath) {
        variables[TRAEFIK_VARIABLES.HEALTH_CHECK_PATH] = context.service.healthCheckPath;
      }
    }

    // Deployment variables
    if (context.deployment) {
      variables[TRAEFIK_VARIABLES.DEPLOYMENT_ID] = context.deployment.id;
      variables[TRAEFIK_VARIABLES.CONTAINER_NAME] = context.deployment.containerName;
      variables[TRAEFIK_VARIABLES.CONTAINER_PORT] = context.deployment.containerPort.toString();
      variables[TRAEFIK_VARIABLES.ENVIRONMENT] = context.deployment.environment;
      if (context.deployment.containerId) {
        variables[TRAEFIK_VARIABLES.CONTAINER_ID] = context.deployment.containerId;
      }
    }

    // Domain variables
    if (context.domain) {
      variables[TRAEFIK_VARIABLES.DOMAIN] = context.domain.domain;
      variables[TRAEFIK_VARIABLES.FULL_DOMAIN] = context.domain.fullDomain;
      if (context.domain.subdomain) {
        variables[TRAEFIK_VARIABLES.SUBDOMAIN] = context.domain.subdomain;
      }
      if (context.domain.baseDomain) {
        variables[TRAEFIK_VARIABLES.BASE_DOMAIN] = context.domain.baseDomain;
      }
    }

    // SSL variables
    if (context.ssl) {
      if (context.ssl.certFile) {
        variables[TRAEFIK_VARIABLES.CERT_FILE] = context.ssl.certFile;
      }
      if (context.ssl.keyFile) {
        variables[TRAEFIK_VARIABLES.KEY_FILE] = context.ssl.keyFile;
      }
      if (context.ssl.certResolver) {
        variables[TRAEFIK_VARIABLES.CERT_RESOLVER] = context.ssl.certResolver;
      }
    }

    // Path variables
    if (context.path) {
      if (context.path.prefix) {
        variables[TRAEFIK_VARIABLES.PATH_PREFIX] = context.path.prefix;
      }
      if (context.path.healthCheck) {
        variables[TRAEFIK_VARIABLES.HEALTH_CHECK_PATH] = context.path.healthCheck;
      }
    }

    // Network variables
    if (context.network) {
      variables[TRAEFIK_VARIABLES.NETWORK_NAME] = context.network.name;
      if (context.network.id) {
        variables[TRAEFIK_VARIABLES.NETWORK_ID] = context.network.id;
      }
    }

    // Project variables
    if (context.project) {
      variables[TRAEFIK_VARIABLES.PROJECT_ID] = context.project.id;
      variables[TRAEFIK_VARIABLES.PROJECT_NAME] = context.project.name;
    }

    // Route variables
    if (context.route) {
      if (context.route.routerName) {
        variables[TRAEFIK_VARIABLES.ROUTER_NAME] = context.route.routerName;
      }
      if (context.route.serviceName) {
        variables[TRAEFIK_VARIABLES.SERVICE_NAME_TRAEFIK] = context.route.serviceName;
      }
      if (context.route.middlewareName) {
        variables[TRAEFIK_VARIABLES.MIDDLEWARE_NAME] = context.route.middlewareName;
      }
      if (context.route.entryPoint) {
        variables[TRAEFIK_VARIABLES.ENTRY_POINT] = context.route.entryPoint;
      }
      if (context.route.priority !== undefined) {
        variables[TRAEFIK_VARIABLES.PRIORITY] = context.route.priority.toString();
      }
    }

    // Custom variables
    if (context.custom) {
      for (const [key, value] of Object.entries(context.custom)) {
        variables[`~##${key}##~`] = String(value);
      }
    }

    return variables;
  }

  /**
   * Resolve variables in a string
   */
  resolveString(template: string, context: VariableResolutionContext): string {
    const variables = this.buildVariableMap(context);
    let resolved = template;

    for (const [variable, value] of Object.entries(variables)) {
      // Use global regex to replace all occurrences
      resolved = resolved.replace(new RegExp(this.escapeRegex(variable), 'g'), value);
    }

    return resolved;
  }

  /**
   * Resolve variables in a TraefikConfig object recursively
   */
  resolveConfig(config: any, context: VariableResolutionContext): any {
    if (typeof config === 'string') {
      return this.resolveString(config, context);
    }

    if (Array.isArray(config)) {
      return config.map(item => this.resolveConfig(item, context));
    }

    if (config && typeof config === 'object') {
      const resolved: any = {};
      for (const [key, value] of Object.entries(config)) {
        // Resolve both keys and values
        const resolvedKey = this.resolveString(key, context);
        resolved[resolvedKey] = this.resolveConfig(value, context);
      }
      return resolved;
    }

    return config;
  }

  /**
   * Resolve variables in a TraefikConfigBuilder
   * Returns a new builder with resolved variables
   */
  resolveBuilder(builder: TraefikConfigBuilder, context: VariableResolutionContext): TraefikConfigBuilder {
    // Build the config from the builder
    const config = builder.build();

    // Resolve all variables in the config
    const resolvedConfig = this.resolveConfig(config, context);

    // Create a new builder from the resolved config
    return TraefikConfigBuilder.load(resolvedConfig);
  }

  /**
   * Check if a string contains any variables
   */
  hasVariables(text: string): boolean {
    return /\{\{[^}]+\}\}/.test(text);
  }

  /**
   * Extract all variables from a string
   */
  extractVariables(text: string): string[] {
    const matches = text.match(/\{\{[^}]+\}\}/g);
    return matches ? [...new Set(matches)] : [];
  }

  /**
   * Validate that all required variables are present in context
   */
  validateContext(template: string, context: VariableResolutionContext): {
    valid: boolean;
    missingVariables: string[];
  } {
    const variables = this.extractVariables(template);
    const availableVariables = this.buildVariableMap(context);
    const missingVariables = variables.filter(v => !(v in availableVariables));

    return {
      valid: missingVariables.length === 0,
      missingVariables,
    };
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
