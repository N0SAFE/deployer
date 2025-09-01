import { Controller } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { TraefikService } from '../services/traefik.service';
import { traefikContract } from '@repo/api-contracts';

@Controller()
export class TraefikController {
  constructor(private readonly traefikService: TraefikService) {}

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
}