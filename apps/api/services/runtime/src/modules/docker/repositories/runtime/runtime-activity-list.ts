/**
 * The runtime activity list: filter by the contract's field filters, sort, page. Pure over already mapped entities.
 */
import type { DockerRuntimeActivityEntity } from "@deployer/contracts-entities";
import type { DockerRuntimeActivityListInput } from "@deployer/runtime-contracts/modules/docker/runtime/activity";

import { getFilterEntry, matchString, paginate, sortItems } from "../shared/list-query";

export function listRuntimeActivityEntities(
  entities: readonly DockerRuntimeActivityEntity[],
  input: DockerRuntimeActivityListInput,
) {
  const filtered = entities.filter(
    (item) =>
      matchString(item.source, getFilterEntry(input, "source"))
      && matchString(item.action, getFilterEntry(input, "action"))
      && matchString(item.actorId ?? "", getFilterEntry(input, "actorId"))
      && matchString(item.status, getFilterEntry(input, "status"))
      && matchString(item.category, getFilterEntry(input, "category"))
      && matchString(item.severity, getFilterEntry(input, "severity"))
      && matchString(item.stage ?? "", getFilterEntry(input, "stage"))
      && matchString(item.scanner ?? "", getFilterEntry(input, "scanner"))
      && matchString(item.flowId, getFilterEntry(input, "flowId"))
      && matchString(item.dependsOnFlowId ?? "", getFilterEntry(input, "dependsOnFlowId")),
  );

  const sorted = sortItems(filtered, input, (item, sortBy) => {
    switch (sortBy) {
      case "source":
        return item.source;
      case "action":
        return item.action;
      case "status":
        return item.status;
      case "category":
        return item.category;
      case "createdAt":
        return item.createdAt;
      case "updatedAt":
        return item.updatedAt;
      case "occurredAt":
      default:
        return item.occurredAt;
    }
  });

  return paginate(sorted, { limit: input.limit, offset: input.offset });
}
