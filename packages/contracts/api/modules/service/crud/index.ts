import { oc } from "@orpc/contract";
import { serviceListContract, serviceListConfigSchemas, type ServiceListInput } from "../list";
import { serviceFindByIdContract } from "./find-by-id";
import { serviceCreateContract, serviceCreateInputSchema, type ServiceCreateInput } from "./create";
import { serviceUpdateContract, serviceUpdateInputSchema, type ServiceUpdateInput } from "./update";
import { serviceDeleteContract } from "./delete";
import { serviceChildrenContract, serviceSubtreeContract } from "./children";

export const serviceCrudContract = oc.tag("Service CRUD").router({
  list: serviceListContract,
  findById: serviceFindByIdContract,
  create: serviceCreateContract,
  update: serviceUpdateContract,
  delete: serviceDeleteContract,
  children: serviceChildrenContract,
  subtree: serviceSubtreeContract,
});

export {
  serviceListContract,
  serviceListConfigSchemas,
  serviceFindByIdContract,
  serviceCreateInputSchema,
  serviceCreateContract,
  serviceUpdateInputSchema,
  serviceUpdateContract,
  serviceDeleteContract,
  serviceChildrenContract,
  serviceSubtreeContract,
};

export type {
  ServiceListInput,
  ServiceCreateInput,
  ServiceUpdateInput,
};