import { standardDomainErrorContracts } from "@repo/orpc-utils";
import { serviceOps } from "./shared";

export const serviceDeleteContract = serviceOps
  .delete()
  .errors((e) => [
    // 404 for unknown service id; 409 when the service has running deployments.
    ...standardDomainErrorContracts(e),
  ])
  .build();
