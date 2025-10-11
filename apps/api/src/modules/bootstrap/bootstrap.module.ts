
import { Module } from '@nestjs/common';


import { SwarmBootstrap } from '@/modules/bootstrap/services/swarm.bootstrap';
import { CoreModule } from '@/core/core.module';
import { ZombieCleanupBootstrap } from '@/modules/bootstrap/services/zombie-cleanup.bootstrap';
import { FileUploadBootstrap } from '@/modules/bootstrap/services/file-upload.bootstrap';
import { TraefikBootstrap } from '@/modules/bootstrap/services/traefik.bootstrap';

@Module({
  imports: [CoreModule],
  providers: [SwarmBootstrap, FileUploadBootstrap, ZombieCleanupBootstrap, TraefikBootstrap, TraefikBootstrap],
  exports: [],
})
export class BootstrapModule {}
