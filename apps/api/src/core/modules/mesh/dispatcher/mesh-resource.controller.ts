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

/**
 * SINGLE controller for ALL mesh resource operations.
 *
 * ONE @Implement, ONE route: POST /api/mesh/:entityKey/:methodName.
 * The dispatcher resolves the correct handler at runtime.
 *
 * Auth note: requireAuth() is applied here to protect all mesh endpoints.
 * The type cast is needed because ORPC's middleware type composition with
 * a generic catch-all contract produces deeply nested generics.
 */
@Controller()
export class MeshResourceController {
  constructor(
    private readonly dispatcher: MeshResourceDispatcher,
  ) {}

  @Implement(meshBaseResourceContract)
  handle() {
    const procedure = implement(meshBaseResourceContract)
      .use(requireAuth())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .handler(async ({ input }: any) => {
        const { entityKey, methodName } = input.params;
        return this.dispatcher.dispatch(entityKey, methodName, input.body);
      });
    return procedure;
  }
}
