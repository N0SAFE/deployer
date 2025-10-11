import { Controller, Logger } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { serviceContract } from '@repo/api-contracts';
import { ServiceService } from '@/core/modules/service/services/service.service';

@Controller()
export class ServiceController {
    private readonly logger = new Logger(ServiceController.name);
    
    constructor(
        private readonly serviceService: ServiceService,
    ) { }

    @Implement(serviceContract.listByProject)
    listByProject() {
        return implement(serviceContract.listByProject).handler(async ({ input }) => {
            this.logger.log(`Listing services for project: ${input.projectId}`);
            return await this.serviceService.listServicesByProject(input);
        });
    }

    @Implement(serviceContract.getById)
    getById() {
        return implement(serviceContract.getById).handler(async ({ input }) => {
            this.logger.log(`Getting service by id: ${input.id}`);
            return await this.serviceService.getServiceById(input.id);
        });
    }

    @Implement(serviceContract.create)
    create() {
        return implement(serviceContract.create).handler(async ({ input }) => {
            this.logger.log(`Creating service: ${input.name} for project: ${input.projectId}`);
            return await this.serviceService.createService(input);
        });
    }

    @Implement(serviceContract.update)
    update() {
        return implement(serviceContract.update).handler(async ({ input }) => {
            this.logger.log(`Updating service: ${input.id}`);
            return await this.serviceService.updateService(input.id, input);
        });
    }

    @Implement(serviceContract.delete)
    delete() {
        return implement(serviceContract.delete).handler(async ({ input }) => {
            this.logger.log(`Deleting service: ${input.id}`);
            return await this.serviceService.deleteService(input.id);
        });
    }

    @Implement(serviceContract.getDeployments)
    getDeployments() {
        return implement(serviceContract.getDeployments).handler(async ({ input }) => {
            this.logger.log(`Getting deployments for service: ${input.id}`);
            return await this.serviceService.getServiceDeployments(input.id, input);
        });
    }

    @Implement(serviceContract.getDependencies)
    getDependencies() {
        return implement(serviceContract.getDependencies).handler(async ({ input }) => {
            this.logger.log(`Getting dependencies for service: ${input.id}`);
            return await this.serviceService.getServiceDependencies(input.id);
        });
    }

    @Implement(serviceContract.addDependency)
    addDependency() {
        return implement(serviceContract.addDependency).handler(async ({ input }) => {
            this.logger.log(`Adding dependency for service: ${input.id}`);
            return await this.serviceService.addServiceDependency(input.id, input.dependsOnServiceId, input.isRequired);
        });
    }

    @Implement(serviceContract.removeDependency)
    removeDependency() {
        return implement(serviceContract.removeDependency).handler(async ({ input }) => {
            this.logger.log(`Removing dependency: ${input.dependencyId} for service: ${input.id}`);
            return await this.serviceService.removeServiceDependency(input.id, input.dependencyId);
        });
    }

    @Implement(serviceContract.toggleActive)
    toggleActive() {
        return implement(serviceContract.toggleActive).handler(async ({ input }) => {
            this.logger.log(`Toggling active status for service: ${input.id} to ${input.isActive}`);
            return await this.serviceService.toggleServiceActive(input.id, input.isActive);
        });
    }

    @Implement(serviceContract.getLogs)
    getLogs() {
        return implement(serviceContract.getLogs).handler(async ({ input }) => {
            this.logger.log(`Getting logs for service: ${input.id}`);
            return await this.serviceService.getServiceLogs(input.id, undefined, {
                level: input.level,
            }, input.limit, input.offset);
        });
    }

    @Implement(serviceContract.getMetrics)
    getMetrics() {
        return implement(serviceContract.getMetrics).handler(async ({ input }) => {
            this.logger.log(`Getting metrics for service: ${input.id}`);
            return await this.serviceService.getServiceMetrics(input.id);
        });
    }

    @Implement(serviceContract.getHealth)
    getHealth() {
        return implement(serviceContract.getHealth).handler(async ({ input }) => {
            this.logger.log(`Getting health status for service: ${input.id}`);
            return await this.serviceService.getServiceHealth(input.id);
        });
    }

    @Implement(serviceContract.getTraefikConfig)
    getTraefikConfig() {
        return implement(serviceContract.getTraefikConfig).handler(async ({ input }) => {
            this.logger.log(`Getting Traefik configuration for service: ${input.id}`);
            return await this.serviceService.getTraefikConfig(input.id);
        });
    }

    @Implement(serviceContract.updateTraefikConfig)
    updateTraefikConfig() {
        return implement(serviceContract.updateTraefikConfig).handler(async ({ input }) => {
            this.logger.log(`Updating Traefik configuration for service: ${input.id}`);
            return await this.serviceService.updateTraefikConfig(input.id, input);
        });
    }

    @Implement(serviceContract.syncTraefikConfig)
    syncTraefikConfig() {
        return implement(serviceContract.syncTraefikConfig).handler(async ({ input }) => {
            this.logger.log(`Syncing Traefik configuration for service: ${input.id}`);
            return await this.serviceService.syncTraefikConfig(input.id);
        });
    }

    @Implement(serviceContract.getProjectDependencyGraph)
    getProjectDependencyGraph() {
        return implement(serviceContract.getProjectDependencyGraph).handler(async ({ input }) => {
            this.logger.log(`Getting dependency graph for project: ${input.projectId}`);
            return await this.serviceService.getProjectDependencyGraph(input.projectId);
        });
    }
}
