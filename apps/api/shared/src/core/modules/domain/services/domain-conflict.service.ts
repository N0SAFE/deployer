import { Injectable, Logger } from '@nestjs/common';
import { ServiceDomainMappingService } from './service-domain-mapping.service';
import type { SubdomainAvailabilityResult } from '../interfaces';

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
            message: `This subdomain is shared with ${String(existingMappings.length)} other service(s) using different base paths.`,
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
    const pathPart = basePath ?? '';
    return `https://${subdomainPart}{domain}${pathPart}`;
  }

  /**
   * Validate subdomain format.
   * 
   * Supports multi-level subdomains (e.g., 'staging.api', 'v2.staging.api').
   * Each label is validated separately according to DNS naming rules.
   * 
   * @param subdomain - The subdomain to validate (can be multi-level with dots)
   * @returns Validation result with error message if invalid
   */
  validateSubdomain(subdomain: string): { valid: boolean; error?: string } {
    if (!subdomain) {
      return { valid: true }; // null/empty is valid (root domain)
    }

    // DNS subdomain label rules (each part separated by dots)
    const labelRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i;
    
    // Split into labels for multi-level subdomains (e.g., 'staging.api' → ['staging', 'api'])
    const labels = subdomain.split('.');
    
    for (const label of labels) {
      if (label.length === 0) {
        return { valid: false, error: 'Subdomain cannot have empty labels (consecutive dots)' };
      }
      
      if (label.length > 63) {
        return { valid: false, error: `Each subdomain label must be 63 characters or less (found: "${label}")` };
      }

      if (!labelRegex.test(label)) {
        return { 
          valid: false, 
          error: `Label "${label}" must start and end with alphanumeric characters, and can contain hyphens`
        };
      }
    }

    // Total subdomain length check (max 253 chars for full domain)
    if (subdomain.length > 253) {
      return { valid: false, error: 'Total subdomain must be 253 characters or less' };
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
