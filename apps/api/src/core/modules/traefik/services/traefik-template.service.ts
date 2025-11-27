import { Injectable, Logger } from '@nestjs/common';
import { TraefikTemplateRepository } from '../repositories/traefik-template.repository';
import {
  providerTraefikTemplates,
  serviceTraefikTemplates,
  type ProviderTraefikTemplate,
  type ServiceTraefikTemplate,
  type CreateProviderTraefikTemplate,
  type CreateServiceTraefikTemplate,
} from '../../../../config/drizzle/schema';
import { nanoid } from 'nanoid';

export interface TemplateVariable {
  name: string;
  description: string;
  required: boolean;
  defaultValue?: string;
  example?: string;
}

export interface TemplateVariables {
  [key: string]: TemplateVariable;
}

export interface ParsedTemplate {
  content: string;
  variables: TemplateVariables;
  usedVariables: string[];
}

@Injectable()
export class TraefikTemplateService {
  private readonly logger = new Logger(TraefikTemplateService.name);

  constructor(
    private readonly traefikTemplateRepository: TraefikTemplateRepository,
  ) {}

  /**
   * Parse template and replace variables with actual values
   */
  parseTemplate(template: string, variables: Record<string, any>): string {
    let result = template;
    
    // Replace ~##variable##~ with actual value
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`~##\\s*${key}\\s*##~`, 'g');
      result = result.replace(regex, String(value ?? ''));
    }
    
    // Check for unreplaced variables
    const unreplacedVars = result.match(/~##[^#]+##~/g);
    if (unreplacedVars && unreplacedVars.length > 0) {
      this.logger.warn(`Unreplaced variables found: ${unreplacedVars.join(', ')}`);
    }
    
    return result;
  }

  /**
   * Extract variable names from template
   */
  extractVariables(template: string): string[] {
    const regex = /~##\\s*([^#\\s]+)\\s*##~/g;
    const variables: string[] = [];
    let match;
    
    while ((match = regex.exec(template)) !== null) {
      if (!variables.includes(match[1])) {
        variables.push(match[1]);
      }
    }
    
    return variables;
  }

  /**
   * Validate that all required variables are provided
   */
  validateVariables(
    requiredVariables: TemplateVariables,
    providedVariables: Record<string, any>,
  ): { valid: boolean; missing: string[] } {
    const missing: string[] = [];
    
    for (const [key, varDef] of Object.entries(requiredVariables)) {
      if (varDef.required && !providedVariables[key]) {
        missing.push(key);
      }
    }
    
    return {
      valid: missing.length === 0,
      missing,
    };
  }

  /**
   * Get provider template by type
   */
  async getProviderTemplate(providerType: string): Promise<ProviderTraefikTemplate | null> {
    return this.traefikTemplateRepository.findProviderByType(providerType);
  }

  /**
   * Get service template
   */
  async getServiceTemplate(serviceId: string): Promise<ServiceTraefikTemplate | null> {
    return this.traefikTemplateRepository.findActiveByServiceId(serviceId);
  }

  /**
   * Create provider template
   */
  async createProviderTemplate(data: CreateProviderTraefikTemplate): Promise<ProviderTraefikTemplate> {
    const id = data.id || nanoid();
    const extractedVars = this.extractVariables(data.templateContent);
    
    // Build variables metadata if not provided
    const variables = data.variables || this.buildVariablesMetadata(extractedVars);
    
    const template = await this.traefikTemplateRepository.createProviderTemplate({
      id,
      providerType: data.providerType,
      templateName: data.templateName,
      templateContent: data.templateContent,
      description: data.description || null,
      variables,
      isDefault: data.isDefault ?? true,
    });
    
    this.logger.log(`Created provider template for ${data.providerType}`);
    return template;
  }

  /**
   * Create service template
   */
  async createServiceTemplate(data: CreateServiceTraefikTemplate): Promise<ServiceTraefikTemplate> {
    const id = data.id || nanoid();
    const extractedVars = this.extractVariables(data.templateContent);
    
    // Build variables metadata if not provided
    const variables = data.variables || this.buildVariablesMetadata(extractedVars);
    
    const template = await this.traefikTemplateRepository.createServiceTemplate({
      id,
      serviceId: data.serviceId,
      templateContent: data.templateContent,
      variables,
      isActive: data.isActive ?? true,
    });
    
    this.logger.log(`Created service template for service ${data.serviceId}`);
    return template;
  }

  /**
   * Update service template
   */
  async updateServiceTemplate(
    id: string,
    updates: Partial<CreateServiceTraefikTemplate>,
  ): Promise<ServiceTraefikTemplate> {
    const updateData: any = {
      updatedAt: new Date(),
    };
    
    if (updates.templateContent) {
      updateData.templateContent = updates.templateContent;
      updateData.variables = this.buildVariablesMetadata(
        this.extractVariables(updates.templateContent),
      );
    }
    
    if (updates.isActive !== undefined) {
      updateData.isActive = updates.isActive;
    }
    
    const template = await this.traefikTemplateRepository.updateServiceTemplate(id, updateData);
    
    this.logger.log(`Updated service template ${id}`);
    return template;
  }

  /**
   * Build variables metadata from extracted variable names
   */
  private buildVariablesMetadata(variableNames: string[]): TemplateVariables {
    const metadata: TemplateVariables = {};
    
    const knownVariables: Record<string, Partial<TemplateVariable>> = {
      domain: {
        description: 'Full domain name',
        required: true,
        example: 'example.com',
      },
      subdomain: {
        description: 'Subdomain (optional)',
        required: false,
        example: 'api',
      },
      host: {
        description: 'Complete host (subdomain.domain or just domain)',
        required: true,
        example: 'api.example.com',
      },
      projectId: {
        description: 'Project UUID',
        required: true,
      },
      serviceId: {
        description: 'Service ID',
        required: true,
      },
      serviceName: {
        description: 'Service name',
        required: true,
        example: 'api-service',
      },
      containerName: {
        description: 'Container name',
        required: true,
        example: 'project-http-abc123',
      },
      containerPort: {
        description: 'Container port',
        required: true,
        defaultValue: '80',
        example: '80',
      },
      routerName: {
        description: 'Traefik router name',
        required: true,
      },
      middlewareName: {
        description: 'Traefik middleware name',
        required: false,
      },
      pathPrefix: {
        description: 'Path prefix for the service',
        required: false,
        example: '/api',
      },
    };
    
    for (const varName of variableNames) {
      const known = knownVariables[varName];
      metadata[varName] = {
        name: varName,
        description: known?.description || `Variable ${varName}`,
        required: known?.required ?? false,
        defaultValue: known?.defaultValue,
        example: known?.example,
      };
    }
    
    return metadata;
  }

  /**
   * Get template for deployment (service-specific or provider default)
   */
  async getTemplateForDeployment(
    serviceId: string,
    providerType: string,
  ): Promise<{ template: string; variables: TemplateVariables } | null> {
    // Try service-specific template first
    const serviceTemplate = await this.getServiceTemplate(serviceId);
    if (serviceTemplate) {
      return {
        template: serviceTemplate.templateContent,
        variables: (serviceTemplate.variables as TemplateVariables) || {},
      };
    }
    
    // Fallback to provider default template
    const providerTemplate = await this.getProviderTemplate(providerType);
    if (providerTemplate) {
      return {
        template: providerTemplate.templateContent,
        variables: (providerTemplate.variables as TemplateVariables) || {},
      };
    }
    
    this.logger.warn(
      `No template found for service ${serviceId} or provider ${providerType}`,
    );
    return null;
  }

  /**
   * Render template for deployment
   */
  async renderTemplateForDeployment(
    serviceId: string,
    providerType: string,
    variables: Record<string, any>,
  ): Promise<string | null> {
    const templateData = await this.getTemplateForDeployment(serviceId, providerType);
    if (!templateData) {
      return null;
    }
    
    // Validate variables
    const validation = this.validateVariables(templateData.variables, variables);
    if (!validation.valid) {
      this.logger.error(
        `Missing required variables for template: ${validation.missing.join(', ')}`,
      );
      throw new Error(`Missing required variables: ${validation.missing.join(', ')}`);
    }
    
    // Parse and return rendered template
    return this.parseTemplate(templateData.template, variables);
  }
}
