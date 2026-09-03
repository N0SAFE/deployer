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
    serviceChildrenContract,
    serviceSubtreeContract,
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
import {
    servicePreviewTopologyContract,
    previewTopologyResolveContract,
    resolvedPreviewNodeSchema,
    previewResolutionKindSchema,
    type ResolvedPreviewNode,
    type PreviewResolutionKind,
} from "./preview-topology";
import {
    serviceNetworkContract,
    serviceGetNetworkContract,
    serviceUpdateNetworkContract,
    serviceProvisionDnsRecordContract,
    type ServiceNetworkView,
    type ServiceUpdateNetworkInput,
    type ServiceProvisionDnsRecordInput,
} from "./network";

export const serviceContract = oc.tag("Service").prefix("/services").router({
    crud: serviceCrudContract,
    lifecycle: serviceLifecycleContract,
    dependencies: serviceDependenciesContract,
    streams: serviceStreamsContract,
    network: serviceNetworkContract,
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
    serviceChildrenContract,
    serviceSubtreeContract,
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

export {
    servicePreviewTopologyContract,
    previewTopologyResolveContract,
    resolvedPreviewNodeSchema,
    previewResolutionKindSchema,
};

export {
    serviceNetworkContract,
    serviceGetNetworkContract,
    serviceUpdateNetworkContract,
    serviceProvisionDnsRecordContract,
};

export type {
    ResolvedPreviewNode,
    PreviewResolutionKind,
    ServiceNetworkView,
    ServiceUpdateNetworkInput,
    ServiceProvisionDnsRecordInput,
};
