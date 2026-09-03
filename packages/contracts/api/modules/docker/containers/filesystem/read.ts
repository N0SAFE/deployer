import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import {
  dockerContainerReadFileQuerySchema,
  dockerContainerReadFileSchema,
} from "../shared";

const dockerContainerReadFileOps = standard.zod(
  dockerContainerReadFileSchema,
  "dockerContainerReadFile",
);

export const dockerContainerReadFileContract = dockerContainerReadFileOps
  .list()
  .path("/read")
  .input((b) => b.query(dockerContainerReadFileQuerySchema))
  .output((b) => b.body(dockerContainerReadFileSchema))
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();