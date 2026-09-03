import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import {
  dockerContainerGroupedListSchema,
  dockerContainerListInputSchema,
} from "./shared";

const dockerContainerGroupedListOps = standard.zod(
  dockerContainerGroupedListSchema,
  "dockerContainerGroupedList",
);

export const dockerListContainersGroupedContract = dockerContainerGroupedListOps
  .list()
  .path("/grouped")
  .input((b) => b.query(dockerContainerListInputSchema))
  .output((b) => b.body(dockerContainerGroupedListSchema))
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();