import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";

import { serviceAddDependencyContract } from "./add";
import { serviceGetDependenciesContract } from "./list";
import { serviceRemoveDependencyContract } from "./remove";

export const serviceDependenciesContract = oc.meta(openapi({ tags: ["Service Dependencies"] })).router({
  list: serviceGetDependenciesContract,
  add: serviceAddDependencyContract,
  remove: serviceRemoveDependencyContract,
});

export {
  serviceGetDependenciesContract,
  serviceAddDependencyContract,
  serviceRemoveDependencyContract,
};