import { dockerContainerOps, dockerContainerListConfigSchemas } from "./shared";

export const dockerListContainersContract = dockerContainerOps
	.list(dockerContainerListConfigSchemas)
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();
import { standardDomainErrorContracts } from "@repo/orpc-utils";