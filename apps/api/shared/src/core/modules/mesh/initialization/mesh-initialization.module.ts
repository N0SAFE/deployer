import { createModuleContext } from "@deployer/nest-effect";
import { MeshInitializationService } from './services/mesh-initialization.service';

export class MeshInitializationModule extends createModuleContext({
  providers: [MeshInitializationService],
  exports: [MeshInitializationService],
}) {}
