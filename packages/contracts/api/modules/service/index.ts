import { oc } from "@orpc/contract";
import * as z from "zod";
import { serviceListContract, serviceListConfigSchemas, type ServiceListInput } from "./list";
import { serviceFindByIdContract, serviceCreateContract, serviceUpdateContract, serviceDeleteContract, serviceToggleActiveContract, serviceGetDependenciesContract, serviceAddDependencyContract, serviceRemoveDependencyContract } from "./crud";
import { serviceQueryStreamContract } from "./stream";

export const serviceContract = oc.tag("Service").prefix("/services").router({
    list: serviceListContract,
    findById: serviceFindByIdContract,
    create: serviceCreateContract,
    update: serviceUpdateContract,
    delete: serviceDeleteContract,
    toggleActive: serviceToggleActiveContract,
    getDependencies: serviceGetDependenciesContract,
    addDependency: serviceAddDependencyContract,
    removeDependency: serviceRemoveDependencyContract,
    streamQuery: serviceQueryStreamContract,
});

export type ServiceContract = typeof serviceContract;

export * from "./list";
export * from "./crud";
export * from "./stream";
