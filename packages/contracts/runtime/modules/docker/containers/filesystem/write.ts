import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
import {
  dockerContainerTerminalMutationAckSchema,
  dockerContainerWriteFileBodySchema,
} from "../shared";

const dockerContainerWriteFileOps = standard.zod(
  dockerContainerTerminalMutationAckSchema,
  "dockerContainerWriteFile",
);

export const dockerContainerWriteFileContract = dockerContainerWriteFileOps
  .create()
  .path("/write")
  .input((b) => b.body(dockerContainerWriteFileBodySchema))
  .output((b) => b.body(dockerContainerTerminalMutationAckSchema))
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();