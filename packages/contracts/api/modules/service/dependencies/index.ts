import { oc } from "@orpc/contract";
import { serviceGetDependenciesContract } from "./list";
import { serviceAddDependencyContract } from "./add";
import { serviceRemoveDependencyContract } from "./remove";

export const serviceDependenciesContract = oc.tag("Service Dependencies").router({
  list: serviceGetDependenciesContract,
  add: serviceAddDependencyContract,
  remove: serviceRemoveDependencyContract,
});

export {
  serviceGetDependenciesContract,
  serviceAddDependencyContract,
  serviceRemoveDependencyContract,
};