import { Injectable, Logger } from '@nestjs/common';
import { ServiceService } from '../../../core/modules/service/services/service.service';
import { TraefikService } from '../../../core/modules/traefik/services/traefik.service';

/**
 * Service Traefik Integration Service
 * Handles Traefik configuration updates when services are created/updated/deleted
 * 
 * This is a feature-level service that combines:
 * - Core ServiceService for business logic
 * - TraefikService for routing configuration
 */
@Injectable()
export class ServiceTraefikIntegrationService {
    private readonly logger = new Logger(ServiceTraefikIntegrationService.name);

    constructor(
        private readonly serviceService: ServiceService,
        private readonly traefikService: TraefikService,
    ) { }

    async createServiceWithTraefik(data: any) {
        this.logger.log(`Creating service with Traefik integration: ${data.name}`);
        
        // Create service using core service
        const service = await this.serviceService.createService(data);
        
        // Create Traefik configuration
        await this.createTraefikConfigForService(service);
        
        return service;
    }

    async updateServiceWithTraefik(id: string, data: any) {
        this.logger.log(`Updating service with Traefik integration: ${id}`);
        
        const existingService = await this.serviceService.getService(id);
        const updatedService = await this.serviceService.updateService(id, data);
        
        // If port changed, update Traefik configuration
        if (data.port && data.port !== existingService.port) {
            await this.updateTraefikConfigForService(updatedService);
        }
        
        return updatedService;
    }

    async deleteServiceWithTraefik(id: string) {
        this.logger.log(`Deleting service with Traefik integration: ${id}`);
        
        const service = await this.serviceService.getService(id);
        
        // Clean up Traefik configurations
        await this.cleanupTraefikConfigForService(service);
        
        // Delete the service
        return await this.serviceService.deleteService(id);
    }

    private async createTraefikConfigForService(service: any) {
        this.logger.log(`Creating Traefik configuration for service: ${service.id}`);
        try {
            // TODO: Implement service-based Traefik configuration with new schema
            // For now, we'll create minimal configs directly in the database
            
            this.logger.log(`Traefik configuration placeholder created for service: ${service.id}`);
        }
        catch (error) {
            const err = error as Error;
            this.logger.error(`Error creating Traefik config for service ${service.id}: ${err.message}`, err.stack);
            // Don't throw error here to avoid blocking service creation
        }
    }

    private async updateTraefikConfigForService(service: any) {
        this.logger.log(`Updating Traefik configuration for service: ${service.id}`);
        try {
            // TODO: Implement Traefik configuration update with new schema
            // For now, we'll skip the complex instance-based updates
            
            this.logger.log(`Traefik config update placeholder for service: ${service.id}`);
        }
        catch (error) {
            const err = error as Error;
            this.logger.error(`Error updating Traefik config for service ${service.id}: ${err.message}`, err.stack);
        }
    }

    private async cleanupTraefikConfigForService(service: any) {
        this.logger.log(`Cleaning up Traefik configuration for service: ${service.id}`);
        try {
            // TODO: Implement Traefik configuration cleanup with new schema
            // For now, we'll skip the complex instance-based cleanup
            
            this.logger.log(`Traefik cleanup placeholder for service: ${service.id}`);
        }
        catch (error) {
            const err = error as Error;
            this.logger.error(`Error cleaning up Traefik config for service ${service.id}: ${err.message}`, err.stack);
        }
    }
}
