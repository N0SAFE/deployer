import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { serviceToggleActiveContract } from "./toggle-active";

export const serviceLifecycleContract = oc.meta(openapi({ tags: ["Service Lifecycle"] })).router({
  toggleActive: serviceToggleActiveContract,
});

export { serviceToggleActiveContract };