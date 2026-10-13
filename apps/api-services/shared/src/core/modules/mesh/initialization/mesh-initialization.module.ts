import { Module } from "@nestjs/common";
import { MeshInitializationService } from '@/core/modules/mesh/initialization/services/mesh-initialization.service';

@Module({
  providers: [MeshInitializationService],
  exports: [MeshInitializationService],
})
export class MeshInitializationModule {}
