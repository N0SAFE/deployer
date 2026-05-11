import { dockerContainerOps, dockerContainerListConfigSchemas } from "./shared";

export const dockerListContainersContract = dockerContainerOps
	.list(dockerContainerListConfigSchemas)
	.build();