import { oc } from "@orpc/contract";
import {
    getAllProvidersContract,
    getProviderSchemaContract,
    getCompatibleBuildersContract,
    getAllBuildersContract,
    getBuilderSchemaContract,
    getCompatibleProvidersContract,
    validateProviderConfigContract,
    validateBuilderConfigContract,
} from "./contracts";

export const providerSchemaContract = oc.tag("Provider Schema").router({
    getAllProviders: getAllProvidersContract,
    getProviderSchema: getProviderSchemaContract,
    getCompatibleBuilders: getCompatibleBuildersContract,
    getAllBuilders: getAllBuildersContract,
    getBuilderSchema: getBuilderSchemaContract,
    getCompatibleProviders: getCompatibleProvidersContract,
    validateProviderConfig: validateProviderConfigContract,
    validateBuilderConfig: validateBuilderConfigContract,
});

export type ProviderSchemaContract = typeof providerSchemaContract;

export * from "./schemas";
export * from "./contracts";
