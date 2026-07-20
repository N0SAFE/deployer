/**
 * MeshResourceController
 *
 * SINGLE controller for ALL mesh resource operations.
 * Uses ONE @Implement decorator with the meshBaseResourceContract.
 *
 * The contract has path params (:entityKey, :methodName) which ORPC/Express
 * resolves from the URL. The dispatcher routes to the correct handler.
 *
 * Auth is applied ONCE here — covers ALL entities automatically.
 */

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { meshBaseResourceContract } from "@repo/api-contracts/modules/mesh/resource/mesh-base-resource.contract";
import { MeshResourceDispatcher } from "./mesh-resource-dispatcher.service";

/**
 * SINGLE controller for ALL mesh resource operations.
 *
 * ONE @Implement, ONE route: POST /api/mesh/:entityKey/:methodName.
 * The dispatcher resolves the correct handler at runtime.
 *
 * Auth is applied via the global ORPC AuthPlugin (populates context.auth)
 * and via NestJS guards at the module/channel level, not per-handler.
 */
@Controller()
export class MeshResourceController {
  constructor(
    private readonly dispatcher: MeshResourceDispatcher,
  ) {}

  @Implement(meshBaseResourceContract)
  handle() {
    return implement(meshBaseResourceContract)
      .handler(async ({ input }) => {
        const { entityKey, methodName } = input.params;
        return this.dispatcher.dispatch(entityKey, methodName, input.body);
      });
  }
}
