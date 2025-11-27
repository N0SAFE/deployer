import { Injectable, Logger } from '@nestjs/common';
import { ServiceDomainMappingService } from './service-domain-mapping.service';

export interface SubdomainConflict {
  serviceId: string;
  serviceName: string;
  subdomain: string | null;
  basePath: string | null;
  fullUrl: string;
}

export interface SubdomainAvailabilityResult {
  available: boolean;
  conflicts: SubdomainConflict[];
  suggestions: {
    availableBasePaths: string[];
    message: string;
  };
}

@Injectable()
export class DomainConflictService {
  private readonly logger = new Logger(DomainConflictService.name);

  constructor(private readonly serviceDomainMappingService: ServiceDomainMappingService) {}

  /**
   * Check if a subdomain + base path combination is available
   */
  async checkSubdomainAvailability(
    projectDomainId: string,
    subdomain: string | null,
    basePath: string | null,
    excludeServiceId?: string
  ): Promise<SubdomainAvailabilityResult> {
    try {
      // Find all mappings for this project domain with same subdomain
      const existingMappings = await this.serviceDomainMappingService.findByProjectDomainAndPathWithServiceNames(
        projectDomainId,
        subdomain,
        basePath,
        excludeServiceId,
      );

      // Check for exact match (same subdomain + same basePath)
      const exactMatch = existingMappings.find(m => m.basePath === basePath);

      if (exactMatch) {
        return {
          available: false,
          conflicts: existingMappings.map(m => ({
            ...m,
            fullUrl: this.computePlaceholderUrl(m.subdomain, m.basePath),
          })),
          suggestions: {
            availableBasePaths: [],
            message: 'This exact URL is already in use. Please choose a different subdomain or base path.',
          },
        };
      }

      // Check for root path conflict (same subdomain + no basePath)
      if (!basePath && existingMappings.some(m => !m.basePath)) {
        const usedBasePaths = existingMappings.map(m => m.basePath).filter(Boolean) as string[];
        
        return {
          available: false,
          conflicts: existingMappings.map(m => ({
            ...m,
            fullUrl: this.computePlaceholderUrl(m.subdomain, m.basePath),
          })),
          suggestions: {
            availableBasePaths: this.generateAvailableBasePaths(usedBasePaths),
            message: 'This subdomain is already used without a base path. Add a base path to differentiate your service.',
          },
        };
      }

      // If there are mappings but different basePaths, it's available
      if (existingMappings.length > 0) {
        const usedBasePaths = existingMappings.map(m => m.basePath).filter(Boolean) as string[];
        
        return {
          available: true,
          conflicts: existingMappings.map(m => ({
            ...m,
            fullUrl: this.computePlaceholderUrl(m.subdomain, m.basePath),
          })),
          suggestions: {
            availableBasePaths: this.generateAvailableBasePaths(usedBasePaths),
            message: `This subdomain is shared with ${existingMappings.length} other service(s) using different base paths.`,
          },
        };
      }

      // No conflicts
      return {
        available: true,
        conflicts: [],
        suggestions: {
          availableBasePaths: [],
          message: 'This subdomain is available.',
        },
      };
    } catch (error) {
      this.logger.error(`Subdomain availability check failed: ${(error as Error).message}`, (error as Error).stack);
      throw error;
    }
  }

  /**
   * Generate available base path suggestions
   */
  private generateAvailableBasePaths(usedPaths: string[]): string[] {
    const commonPaths = ['/v1', '/v2', '/v3', '/api', '/app', '/web', '/admin', '/dashboard'];
    return commonPaths.filter(path => !usedPaths.includes(path));
  }

  /**
   * Compute placeholder URL for display (domain will be resolved later)
   */
  private computePlaceholderUrl(subdomain: string | null, basePath: string | null): string {
    const subdomainPart = subdomain ? `${subdomain}.` : '';
    const pathPart = basePath || '';
    return `https://${subdomainPart}{domain}${pathPart}`;
  }

  /**
   * Validate subdomain format
   */
  validateSubdomain(subdomain: string): { valid: boolean; error?: string } {
    if (!subdomain) {
      return { valid: true }; // null/empty is valid (root domain)
    }

    // DNS subdomain rules
    const subdomainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i;
    
    if (subdomain.length > 63) {
      return { valid: false, error: 'Subdomain must be 63 characters or less' };
    }

    if (!subdomainRegex.test(subdomain)) {
      return { valid: false, error: 'Subdomain must start and end with alphanumeric characters, and can contain hyphens' };
    }

    return { valid: true };
  }

  /**
   * Validate base path format
   */
  validateBasePath(basePath: string): { valid: boolean; error?: string } {
    if (!basePath) {
      return { valid: true }; // null/empty is valid (root path)
    }

    if (!basePath.startsWith('/')) {
      return { valid: false, error: 'Base path must start with /' };
    }

    if (basePath.length > 255) {
      return { valid: false, error: 'Base path must be 255 characters or less' };
    }

    // Path should not end with / unless it's root
    if (basePath !== '/' && basePath.endsWith('/')) {
      return { valid: false, error: 'Base path should not end with /' };
    }

    return { valid: true };
  }
}
