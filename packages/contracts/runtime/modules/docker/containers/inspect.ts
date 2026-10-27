import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
import { dockerContainerInspectDetailSchema } from "@deployer/contracts-entities";
import { dockerContainerInspectQuerySchema } from "./shared";

const dockerContainerInspectOps = standard.zod(
  dockerContainerInspectDetailSchema,
  "dockerContainerInspect",
);

export const dockerContainerInspectContract = dockerContainerInspectOps
  .list()
  .path("/inspect")
  .input((b) => b.query(dockerContainerInspectQuerySchema))
  .output((b) => b.body(dockerContainerInspectDetailSchema))
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();