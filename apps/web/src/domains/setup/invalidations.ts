import { defineInvalidations } from "@/domains/shared/helpers";
import { setupEndpoints } from "./endpoints";

export const setupInvalidations = defineInvalidations(setupEndpoints, {
  initialize: ({ keys }) => [keys.getStatus(), keys.getStateMachine()],
  configureDatabase: ({ keys }) => [keys.getStatus(), keys.getNodeStatus()],
});

