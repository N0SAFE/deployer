import { Injectable, Logger } from '@nestjs/common';
import { TraefikConfigBuilder } from '@/core/modules/traefik/config-builder/builders/traefik-config-builder';

export interface ValidationError {
  path: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
}

export interface VariableInfo {
  name: string;
  resolved: boolean;
  value?: any;
  error?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors?: ValidationError[];
  warnings?: ValidationWarning[];
  variables?: VariableInfo[];
}

/**
 * Service for validating Traefik configurations
 */
@Injectable()
export class TraefikValidationService {
  private readonly logger = new Logger(TraefikValidationService.name);

  /**
   * Validate a Traefik configuration from YAML content
   * @param configContent YAML configuration content
   * @returns Validation result with errors, warnings, and variable information
   */
  async validateConfig(configContent: string): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const variables: VariableInfo[] = [];

    try {
      // Try to load the configuration
      const builder = TraefikConfigBuilder.load(configContent);

      // Get statistics about the config
      const stats = builder.getStats();
      this.logger.debug(`Config stats: ${JSON.stringify(stats)}`);

      // Build the raw config (without variable resolution)
      const config = builder.build();

      // Validate basic structure
      if (!config.http && !config.tcp && !config.udp) {
        errors.push({
          path: 'root',
          message: 'Configuration must contain at least one of: http, tcp, or udp',
          code: 'EMPTY_CONFIG',
        });
      }

      // Check for HTTP routers without services
      if (config.http?.routers) {
        for (const [routerName, routerConfig] of Object.entries(config.http.routers)) {
          if (!routerConfig.service) {
            errors.push({
              path: `http.routers.${routerName}`,
              message: 'Router must specify a service',
              code: 'MISSING_SERVICE',
            });
          }

          if (!routerConfig.rule) {
            errors.push({
              path: `http.routers.${routerName}`,
              message: 'Router must specify a rule',
              code: 'MISSING_RULE',
            });
          }
        }
      }

      // Check for services without servers
      if (config.http?.services) {
        for (const [serviceName, serviceConfig] of Object.entries(config.http.services)) {
          if ('loadBalancer' in serviceConfig) {
            if (!serviceConfig.loadBalancer?.servers || serviceConfig.loadBalancer.servers.length === 0) {
              errors.push({
                path: `http.services.${serviceName}`,
                message: 'Load balancer must have at least one server',
                code: 'EMPTY_SERVERS',
              });
            }
          } else if ('weighted' in serviceConfig) {
            if (!serviceConfig.weighted?.services || serviceConfig.weighted.services.length === 0) {
              errors.push({
                path: `http.services.${serviceName}`,
                message: 'Weighted service must have at least one service',
                code: 'EMPTY_WEIGHTED_SERVICES',
              });
            }
          } else if ('mirroring' in serviceConfig) {
            if (!serviceConfig.mirroring?.service) {
              errors.push({
                path: `http.services.${serviceName}`,
                message: 'Mirroring service must specify a main service',
                code: 'MISSING_MAIN_SERVICE',
              });
            }
          }
        }
      }

      // Extract variables from config
      const configStr = JSON.stringify(config);
      const variablePattern = /~##([^#]+)##~/g;
      const foundVariables = new Set<string>();
      let match;

      while ((match = variablePattern.exec(configStr)) !== null) {
        foundVariables.add(match[1]);
      }

      // Add variable information
      for (const varName of foundVariables) {
        variables.push({
          name: varName,
          resolved: false, // Variables are not resolved during validation
        });
      }

      // Add warnings for common issues
      if (variables.length > 0 && variables.length > 10) {
        warnings.push({
          path: 'variables',
          message: `Configuration contains ${variables.length} variables, which may be difficult to manage`,
        });
      }

      if (config.http?.middlewares && Object.keys(config.http.middlewares).length > 20) {
        warnings.push({
          path: 'http.middlewares',
          message: `Configuration contains ${Object.keys(config.http.middlewares).length} middlewares, consider splitting into multiple files`,
        });
      }

      return {
        isValid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
        variables: variables.length > 0 ? variables : undefined,
      };
    } catch (error) {
      this.logger.error('Error validating Traefik config:', error);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Parse YAML/JSON errors
      if (errorMessage.includes('YAML') || errorMessage.includes('JSON')) {
        errors.push({
          path: 'root',
          message: `Invalid YAML/JSON format: ${errorMessage}`,
          code: 'PARSE_ERROR',
        });
      } else {
        errors.push({
          path: 'root',
          message: errorMessage,
          code: 'VALIDATION_ERROR',
        });
      }

      return {
        isValid: false,
        errors,
      };
    }
  }
}
