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
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";

@Controller()
export class MeshResourceController {
  constructor(
    private readonly dispatcher: MeshResourceDispatcher,
  ) {}

  /**
   * Single handler for ALL mesh resource operations.
   *
   * POST /api/mesh/:entityKey/:methodName
   *
   * The path params entityKey and methodName are extracted by ORPC from the
   * contract's path pattern and validated by Zod at the contract boundary.
   * The dispatcher resolves the correct handler at runtime from the registry
   * populated by MeshResourceService subclasses during onModuleInit().
   */
  @Implement(meshBaseResourceContract)
  handle() {
    return implement(meshBaseResourceContract)
      .use(requireAuth())
      .handler(async ({ input }) => {
        const { entityKey, methodName } = input.params;
        return this.dispatcher.dispatch(entityKey, methodName, input.body);
      });
  }
}
