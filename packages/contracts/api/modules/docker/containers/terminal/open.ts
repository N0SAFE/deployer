import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import {
  dockerContainerTerminalOpenBodySchema,
  dockerContainerTerminalSessionOpenSchema,
} from "../shared";

const dockerContainerTerminalOpenOps = standard.zod(
  dockerContainerTerminalSessionOpenSchema,
  "dockerContainerTerminalOpen",
);

export const dockerContainerTerminalOpenContract = dockerContainerTerminalOpenOps
  .create()
  .path("/open")
  .input((b) => b.body(dockerContainerTerminalOpenBodySchema))
  .output((b) => b.body(dockerContainerTerminalSessionOpenSchema))
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();