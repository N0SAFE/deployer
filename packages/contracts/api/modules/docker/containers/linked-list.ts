import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { dockerContainerLinkedListSchema } from "@repo/contracts-entities";
import { dockerContainerLinkedListQuerySchema } from "./shared";

const dockerContainerLinkedListOps = standard.zod(
  dockerContainerLinkedListSchema,
  "dockerContainerLinkedList",
);

export const dockerContainerLinkedListContract = dockerContainerLinkedListOps
  .list()
  .path("/linked")
  .input((b) => b.query(dockerContainerLinkedListQuerySchema))
  .output((b) => b.body(dockerContainerLinkedListSchema))
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();