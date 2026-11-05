import { createModuleContext } from "@deployer/nest-effect";

import { makeMeshInitializationService, MeshInitializationService } from "./services/mesh-initialization.service";

export class MeshInitializationModule extends createModuleContext({
  providers: [{ provide: MeshInitializationService, useFactory: () => makeMeshInitializationService() }],
  exports: [MeshInitializationService],
}) {}
