import { oc } from "@orpc/contract";
import { serviceListContract, serviceListConfigSchemas, type ServiceListInput } from "../list";
import { serviceFindByIdContract } from "./find-by-id";
import { serviceCreateContract, serviceCreateInputSchema, type ServiceCreateInput } from "./create";
import { serviceUpdateContract, serviceUpdateInputSchema, type ServiceUpdateInput } from "./update";
import { serviceDeleteContract } from "./delete";

export const serviceCrudContract = oc.tag("Service CRUD").router({
  list: serviceListContract,
  findById: serviceFindByIdContract,
  create: serviceCreateContract,
  update: serviceUpdateContract,
  delete: serviceDeleteContract,
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
};

export type {
  ServiceListInput,
  ServiceCreateInput,
  ServiceUpdateInput,
};