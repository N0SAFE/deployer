import { Module } from "@nestjs/common";
import { MeshInitializationService } from './services/mesh-initialization.service';

@Module({
  providers: [MeshInitializationService],
  exports: [MeshInitializationService],
})
export class MeshInitializationModule {}
