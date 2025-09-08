import { Controller, Logger } from '@nestjs/common';
import { ServiceService } from '../services/service.service';

@Controller('services')
export class ServiceController {
  private readonly logger = new Logger(ServiceController.name);

  constructor(private readonly serviceService: ServiceService) {}

  // Core service endpoints will be implemented here
  // Currently disabled due to contract type alignment issues
  // Implementation includes:
  // - Service creation with automatic Traefik configuration
  // - Service logs retrieval with real database integration  
  // - Service health and metrics endpoints
  // - Integration with deployment system for build logs
}