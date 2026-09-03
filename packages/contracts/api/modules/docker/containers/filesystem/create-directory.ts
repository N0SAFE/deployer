import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import {
  dockerContainerCreateDirectoryBodySchema,
  dockerContainerTerminalMutationAckSchema,
} from "../shared";

const dockerContainerCreateDirectoryOps = standard.zod(
  dockerContainerTerminalMutationAckSchema,
  "dockerContainerCreateDirectory",
);

export const dockerContainerCreateDirectoryContract = dockerContainerCreateDirectoryOps
  .create()
  .path("/mkdir")
  .input((b) => b.body(dockerContainerCreateDirectoryBodySchema))
  .output((b) => b.body(dockerContainerTerminalMutationAckSchema))
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();