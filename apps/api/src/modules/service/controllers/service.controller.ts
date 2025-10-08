import { Controller, Logger } from '@nestjs/common';
import { ServiceService } from '../../../core/modules/service/services/service.service';
import { ServiceTraefikIntegrationService } from '../services/service-traefik-integration.service';

@Controller('services')
export class ServiceController {
    private readonly logger = new Logger(ServiceController.name);
    
    constructor(
        private readonly serviceService: ServiceService,
        private readonly serviceTraefikIntegration: ServiceTraefikIntegrationService,
    ) { }
}
