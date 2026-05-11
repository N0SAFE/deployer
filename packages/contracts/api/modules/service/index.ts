import { oc } from "@orpc/contract";
import {
    serviceCrudContract,
    serviceListContract,
    serviceListConfigSchemas,
    serviceFindByIdContract,
    serviceCreateInputSchema,
    serviceCreateContract,
    serviceUpdateInputSchema,
    serviceUpdateContract,
    serviceDeleteContract,
    type ServiceListInput,
    type ServiceCreateInput,
    type ServiceUpdateInput,
} from "./crud";
import { serviceLifecycleContract, serviceToggleActiveContract } from "./lifecycle";
import {
    serviceDependenciesContract,
    serviceGetDependenciesContract,
    serviceAddDependencyContract,
    serviceRemoveDependencyContract,
} from "./dependencies";
import {
    serviceStreamsContract,
    serviceQueryStreamContract,
    serviceStreamEventTypeSchema,
    serviceStreamEventSchema,
    serviceStreamQueryFiltersSchema,
    type ServiceStreamEvent,
    type ServiceStreamQueryInput,
} from "./streams";

export const serviceContract = oc.tag("Service").prefix("/services").router({
    crud: serviceCrudContract,
    lifecycle: serviceLifecycleContract,
    dependencies: serviceDependenciesContract,
    streams: serviceStreamsContract,
});

export type ServiceContract = typeof serviceContract;

export {
    serviceCrudContract,
    serviceListContract,
    serviceListConfigSchemas,
    serviceFindByIdContract,
    serviceCreateInputSchema,
    serviceCreateContract,
    serviceUpdateInputSchema,
    serviceUpdateContract,
    serviceDeleteContract,
    serviceLifecycleContract,
    serviceToggleActiveContract,
    serviceDependenciesContract,
    serviceGetDependenciesContract,
    serviceAddDependencyContract,
    serviceRemoveDependencyContract,
    serviceStreamsContract,
    serviceQueryStreamContract,
    serviceStreamEventTypeSchema,
    serviceStreamEventSchema,
    serviceStreamQueryFiltersSchema,
};

export type {
    ServiceListInput,
    ServiceCreateInput,
    ServiceUpdateInput,
    ServiceStreamEvent,
    ServiceStreamQueryInput,
};
