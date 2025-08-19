import { Module } from '@nestjs/common';
import { DockerService } from './services/docker.service';
import { GitService } from './services/git.service';

@Module({
  providers: [
    DockerService,
    GitService,
  ],
  exports: [
    DockerService,
    GitService,
  ],
})
export class CoreModule {}