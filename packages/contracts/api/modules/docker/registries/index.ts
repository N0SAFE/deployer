import { oc } from "@orpc/contract";
import { dockerListRegistriesContract } from "./list";

export const dockerRegistriesContract = oc.tag("Docker Registries").prefix("/registries").router({
  list: dockerListRegistriesContract,
});

export { dockerListRegistriesContract };
export { dockerRegistryListConfigSchemas } from "./list";
export type { DockerRegistryListInput } from "./list";
