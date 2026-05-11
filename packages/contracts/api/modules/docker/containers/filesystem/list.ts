import { standard } from "@repo/orpc-utils";
import {
  dockerContainerFilesListSchema,
  dockerContainerFilesQuerySchema,
} from "../shared";

const dockerContainerFilesOps = standard.zod(dockerContainerFilesListSchema, "dockerContainerFiles");

export const dockerContainerFilesContract = dockerContainerFilesOps
  .list()
  .path("/")
  .input((b) => b.query(dockerContainerFilesQuerySchema))
  .output((b) => b.body(dockerContainerFilesListSchema))
  .build();