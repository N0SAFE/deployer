import { Layer } from "effect";

import { PermissionRepository } from "./repositories/permission.repository";
import { PermissionService } from "./services/permission.service";

/** The permission feature, assembled: the service over its repository, both visible to the runtime. */
export const PermissionLive = PermissionService.Live.pipe(Layer.provideMerge(PermissionRepository.Live));
