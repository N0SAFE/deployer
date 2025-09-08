import { Controller } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { TraefikService } from '../services/traefik.service';
import { TraefikStaticConfigService } from '../services/traefik-static-config.service';
import { traefikContract } from '@repo/api-contracts';

@Controller()
export class TraefikController {
  constructor(
    private readonly traefikService: TraefikService,
    private readonly traefikStaticConfigService: TraefikStaticConfigService
  ) {}

  // Instance management endpoints
  @Implement(traefikContract.createInstance)
  createInstance() {
    return implement(traefikContract.createInstance).handler(async ({ input }) => {
      const result = await this.traefikService.createInstance(input);
      return {
        ...result,
        status: result.status as "error" | "stopped" | "starting" | "running" | "stopping"
      };
    });
  }

  @Implement(traefikContract.listInstances)
  listInstances() {
    return implement(traefikContract.listInstances).handler(async () => {
      const instances = await this.traefikService.listInstances();
      return instances.map(instance => ({
        ...instance,
        status: instance.status as "error" | "stopped" | "starting" | "running" | "stopping"
      }));
    });
  }

  @Implement(traefikContract.getInstance)
  getInstance() {
    return implement(traefikContract.getInstance).handler(async ({ input }) => {
      const { instanceId } = input;
      const instance = await this.traefikService.getInstance(instanceId);
      if (!instance) {
        throw new Error(`Traefik instance not found: ${instanceId}`);
      }
      return {
        ...instance,
        status: instance.status as "error" | "stopped" | "starting" | "running" | "stopping"
      };
    });
  }

  @Implement(traefikContract.startInstance)
  startInstance() {
    return implement(traefikContract.startInstance).handler(async ({ input }) => {
      const { instanceId } = input;
      const result = await this.traefikService.startInstance(instanceId);
      return {
        ...result,
        status: result.status as "error" | "stopped" | "starting" | "running" | "stopping"
      };
    });
  }

  @Implement(traefikContract.stopInstance)
  stopInstance() {
    return implement(traefikContract.stopInstance).handler(async ({ input }) => {
      const { instanceId } = input;
      const result = await this.traefikService.stopInstance(instanceId);
      return {
        ...result,
        status: result.status as "error" | "stopped" | "starting" | "running" | "stopping"
      };
    });
  }

  @Implement(traefikContract.healthCheckInstance)
  healthCheckInstance() {
    return implement(traefikContract.healthCheckInstance).handler(async ({ input }) => {
      const { instanceId } = input;
      const healthy = await this.traefikService.healthCheck(instanceId);
      return { healthy };
    });
  }

  // Template management endpoints
  @Implement(traefikContract.listTemplates)
  listTemplates() {
    return implement(traefikContract.listTemplates).handler(async ({ input }) => {
      const { category } = input || {};
      const templates = await this.traefikService.getTemplates(category);
      return templates;
    });
  }

  @Implement(traefikContract.getTemplate)
  getTemplate() {
    return implement(traefikContract.getTemplate).handler(async ({ input }) => {
      const { templateId } = input;
      const template = await this.traefikService.getTemplate(templateId);
      if (!template) {
        throw new Error(`Template not found: ${templateId}`);
      }
      return template;
    });
  }

  @Implement(traefikContract.createInstanceFromTemplate)
  createInstanceFromTemplate() {
    return implement(traefikContract.createInstanceFromTemplate).handler(async ({ input }) => {
      const { templateId, name, customConfig } = input;
      const result = await this.traefikService.createInstanceFromTemplate(templateId, name, customConfig);
      return {
        ...result,
        status: result.status as "error" | "stopped" | "starting" | "running" | "stopping"
      };
    });
  }

  // Domain management endpoints
  @Implement(traefikContract.createDomainConfig)
  createDomainConfig() {
    return implement(traefikContract.createDomainConfig).handler(async ({ input }) => {
      const { instanceId, ...domainConfig } = input;
      const result = await this.traefikService.createDomainConfig(instanceId, domainConfig);
      return result;
    });
  }

  @Implement(traefikContract.listDomainConfigs)
  listDomainConfigs() {
    return implement(traefikContract.listDomainConfigs).handler(async ({ input }) => {
      const { instanceId } = input;
      const result = await this.traefikService.listDomainConfigs(instanceId);
      return result;
    });
  }

  // Route management endpoints
  @Implement(traefikContract.createRouteConfig)
  createRouteConfig() {
    return implement(traefikContract.createRouteConfig).handler(async ({ input }) => {
      const { domainConfigId, ...routeConfig } = input;
      const result = await this.traefikService.createRouteConfig(domainConfigId, routeConfig);
      return result;
    });
  }

  @Implement(traefikContract.listRouteConfigs)
  listRouteConfigs() {
    return implement(traefikContract.listRouteConfigs).handler(async ({ input }) => {
      const { domainConfigId } = input;
      const result = await this.traefikService.listRouteConfigs(domainConfigId);
      return result;
    });
  }

  @Implement(traefikContract.deleteRouteConfig)
  deleteRouteConfig() {
    return implement(traefikContract.deleteRouteConfig).handler(async ({ input }) => {
      const { routeConfigId } = input;
      await this.traefikService.deleteRouteConfig(routeConfigId);
    });
  }

  // Deployment registration endpoints
  @Implement(traefikContract.registerDeployment)
  registerDeployment() {
    return implement(traefikContract.registerDeployment).handler(async ({ input }) => {
      const { instanceId, ...registrationData } = input;
      const result = await this.traefikService.registerDeploymentAdvanced(instanceId, registrationData);
      return result;
    });
  }

  @Implement(traefikContract.unregisterDeployment)
  unregisterDeployment() {
    return implement(traefikContract.unregisterDeployment).handler(async ({ input }) => {
      const { deploymentId } = input;
      await this.traefikService.unregisterDeployment(deploymentId);
    });
  }

  // DNS checking endpoints
  @Implement(traefikContract.checkDNS)
  checkDNS() {
    return implement(traefikContract.checkDNS).handler(async ({ input }) => {
      const { domain, recordType = 'A' } = input;
      const result = await this.traefikService.checkDNS(domain, recordType);
      return result;
    });
  }

  @Implement(traefikContract.validateDomainDNS)
  validateDomainDNS() {
    return implement(traefikContract.validateDomainDNS).handler(async ({ input }) => {
      const { domainConfigId } = input;
      const result = await this.traefikService.validateDomainDNS(domainConfigId);
      return result;
    });
  }

  // Configuration management endpoints
  @Implement(traefikContract.getInstanceConfigs)
  getInstanceConfigs() {
    return implement(traefikContract.getInstanceConfigs).handler(async ({ input }) => {
      const { instanceId } = input;
      const configs = await this.traefikService.getInstanceConfigurations(instanceId);
      
      // Transform to match the API contract
      return configs.map(config => ({
        id: config.id,
        configName: config.configName,
        configType: config.configType,
        syncStatus: config.syncStatus || undefined,
        requiresFile: config.requiresFile || undefined,
        lastSyncedAt: config.lastSyncedAt || undefined,
        configVersion: config.configVersion || undefined,
        metadata: config.metadata || undefined,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      }));
    });
  }

  @Implement(traefikContract.getConfigSyncStatus)
  getConfigSyncStatus() {
    return implement(traefikContract.getConfigSyncStatus).handler(async ({ input }) => {
      const { instanceId } = input;
      const status = await this.traefikService.getConfigurationSyncStatus(instanceId);
      return status;
    });
  }

  @Implement(traefikContract.forceSyncConfigs)
  forceSyncConfigs() {
    return implement(traefikContract.forceSyncConfigs).handler(async ({ input }) => {
      const { instanceId } = input;
      const result = await this.traefikService.forceSyncInstanceConfigurations(instanceId);
      return result;
    });
  }

  @Implement(traefikContract.cleanupOrphanedFiles)
  cleanupOrphanedFiles() {
    return implement(traefikContract.cleanupOrphanedFiles).handler(async ({ input }) => {
      const { instanceId } = input;
      const cleanedFiles = await this.traefikService.cleanupOrphanedConfigFiles(instanceId);
      return {
        cleanedFiles,
        count: cleanedFiles.length
      };
    });
  }

  @Implement(traefikContract.validateConfigFiles)
  validateConfigFiles() {
    return implement(traefikContract.validateConfigFiles).handler(async ({ input }) => {
      const { instanceId } = input;
      const result = await this.traefikService.validateInstanceConfigFiles(instanceId);
      return result;
    });
  }

  @Implement(traefikContract.getInstanceStatus)
  getInstanceStatus() {
    return implement(traefikContract.getInstanceStatus).handler(async ({ input }) => {
      const { instanceId } = input;
      const status = await this.traefikService.getInstanceConfigurationStatus(instanceId);
      return {
        ...status,
        instance: {
          ...status.instance,
          status: status.instance.status as "error" | "stopped" | "starting" | "running" | "stopping"
        }
      };
    });
  }

  // Static Configuration Management endpoints
  @Implement(traefikContract.getStaticConfig)
  getStaticConfig() {
    return implement(traefikContract.getStaticConfig).handler(async ({ input }) => {
      const { instanceId } = input;
      const config = await this.traefikStaticConfigService.getStaticConfig(instanceId);
      return config;
    });
  }

  @Implement(traefikContract.saveStaticConfig)
  saveStaticConfig() {
    return implement(traefikContract.saveStaticConfig).handler(async ({ input }) => {
      const { instanceId, ...configSections } = input;
      const result = await this.traefikStaticConfigService.saveStaticConfig(instanceId, configSections);
      return {
        id: result.id,
        traefikInstanceId: result.traefikInstanceId,
        configVersion: result.configVersion,
        syncStatus: result.syncStatus,
        isValid: result.isValid,
        validationErrors: result.validationErrors,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      };
    });
  }

  @Implement(traefikContract.getStaticConfigYaml)
  getStaticConfigYaml() {
    return implement(traefikContract.getStaticConfigYaml).handler(async ({ input }) => {
      const { instanceId } = input;
      const yaml = await this.traefikStaticConfigService.getCompiledYamlConfig(instanceId);
      const config = await this.traefikStaticConfigService.getStaticConfig(instanceId);
      
      return {
        yaml,
        configVersion: config?.configVersion || 1,
        lastUpdated: config?.updatedAt || new Date(),
      };
    });
  }

  @Implement(traefikContract.updateStaticConfigSection)
  updateStaticConfigSection() {
    return implement(traefikContract.updateStaticConfigSection).handler(async ({ input }) => {
      const { instanceId, section, config } = input;
      const result = await this.traefikStaticConfigService.updateConfigSection(instanceId, section as any, config);
      
      return {
        success: true,
        configVersion: result.configVersion || 1,
        validationErrors: result.validationErrors ? 
          (Array.isArray(result.validationErrors) ? result.validationErrors : []) : 
          undefined,
      };
    });
  }

  @Implement(traefikContract.createDefaultStaticConfig)
  createDefaultStaticConfig() {
    return implement(traefikContract.createDefaultStaticConfig).handler(async ({ input }) => {
      const { instanceId } = input;
      const result = await this.traefikStaticConfigService.createDefaultConfig(instanceId);
      
      return {
        id: result.id,
        traefikInstanceId: result.traefikInstanceId,
        configVersion: result.configVersion,
        isValid: result.isValid,
        validationErrors: result.validationErrors,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      };
    });
  }

  @Implement(traefikContract.validateStaticConfig)
  validateStaticConfig() {
    return implement(traefikContract.validateStaticConfig).handler(async ({ input }) => {
      const { instanceId } = input;
      const config = await this.traefikStaticConfigService.getStaticConfig(instanceId);
      
      if (!config) {
        return {
          isValid: false,
          errors: ['No static configuration found for this instance'],
          warnings: [],
        };
      }

      return {
        isValid: config.isValid || false,
        errors: config.validationErrors ? 
          (Array.isArray(config.validationErrors) ? config.validationErrors : []) : 
          [],
        warnings: [],
      };
    });
  }
}