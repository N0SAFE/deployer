import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import {
  dockerContainerRenamePathBodySchema,
  dockerContainerTerminalMutationAckSchema,
} from "../shared";

const dockerContainerRenamePathOps = standard.zod(
  dockerContainerTerminalMutationAckSchema,
  "dockerContainerRenamePath",
);

export const dockerContainerRenamePathContract = dockerContainerRenamePathOps
  .create()
  .path("/rename")
  .input((b) => b.body(dockerContainerRenamePathBodySchema))
  .output((b) => b.body(dockerContainerTerminalMutationAckSchema))
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();