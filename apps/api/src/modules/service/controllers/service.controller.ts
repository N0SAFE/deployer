import { Controller, Logger } from '@nestjs/common';
import { ServiceService } from '../services/service.service';
@Controller('services')
export class ServiceController {
    private readonly logger = new Logger(ServiceController.name);
    constructor(private readonly serviceService: ServiceService) { }
}
