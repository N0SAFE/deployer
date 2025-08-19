import { Module } from '@nestjs/common';
import { TraefikController } from './controllers/traefik.controller';
import { TraefikService } from './services/traefik.service';
import { DatabaseModule } from '../../core/modules/db/database.module';
import { CoreModule } from '../../core/core.module';

@Module({
  imports: [
    DatabaseModule,
    CoreModule,
  ],
  controllers: [TraefikController],
  providers: [TraefikService],
  exports: [TraefikService],
})
export class TraefikModule {}