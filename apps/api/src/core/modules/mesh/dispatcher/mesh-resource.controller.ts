/**
 * MeshResourceController
 *
 * SINGLE controller for ALL mesh resource operations.
 * Uses ONE @Implement decorator with the meshBaseResourceContract.
 *
 * The contract has path params (:entityKey, :methodName) which ORPC/Express
 * resolves from the URL. The dispatcher routes to the correct handler.
 *
 * Auth is applied via the global ORPC AuthPlugin (populates context.auth)
 * and via NestJS guards at the module/channel level, not per-handler.
 */

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { meshBaseResourceContract } from "@repo/api-contracts/modules/mesh/resource/mesh-base-resource.contract";
import { MeshResourceDispatcher } from "./mesh-resource-dispatcher.service";

@Controller()
export class MeshResourceController {
  constructor(
    private readonly dispatcher: MeshResourceDispatcher,
  ) {}

  @Implement(meshBaseResourceContract as any)
  handle() {
    return (implement as any)(meshBaseResourceContract)
      .handler(async ({ input }: any) => {
        const { entityKey, methodName } = input.params;
        const result = await this.dispatcher.dispatch(entityKey, methodName, input.body);
        return { body: result };
      });
  }
}
