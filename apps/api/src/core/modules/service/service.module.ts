import { Module } from '@nestjs/common';
import { ServiceService } from './services/service.service';
import { ServiceRepository } from './repositories/service.repository';

@Module({
    imports: [
    ],
    providers: [ServiceService, ServiceRepository],
    exports: [ServiceService, ServiceRepository],
})
export class ServiceModule {}
