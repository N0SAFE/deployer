import { Module } from '@nestjs/common';
import { DockerfileBuilderModule } from './dockerfile/dockerfile-builder.module';
import { NixpackBuilderModule } from './nixpack/nixpack-builder.module';
import { BuildpackBuilderModule } from './buildpack/buildpack-builder.module';
import { StaticBuilderModule } from './static/static-builder.module';
import { DockerComposeBuilderModule } from './docker-compose/docker-compose-builder.module';
import { BuilderRegistryService } from './services/builder-registry.service';

@Module({
  imports: [
    DockerfileBuilderModule,
    NixpackBuilderModule,
    BuildpackBuilderModule,
    StaticBuilderModule,
    DockerComposeBuilderModule,
  ],
  providers: [
    BuilderRegistryService
  ],
  exports: [
    DockerfileBuilderModule,
    NixpackBuilderModule,
    BuildpackBuilderModule,
    StaticBuilderModule,
    DockerComposeBuilderModule,
    BuilderRegistryService
  ],
})
export class BuildersModule {}
