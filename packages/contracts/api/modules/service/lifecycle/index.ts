import { oc } from "@orpc/contract";
import { serviceToggleActiveContract } from "./toggle-active";

export const serviceLifecycleContract = oc.tag("Service Lifecycle").router({
  toggleActive: serviceToggleActiveContract,
});

export { serviceToggleActiveContract };