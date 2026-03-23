import { defineInvalidations } from "@/domains/shared/helpers";
import { testEndpoints } from "./endpoints";

export const testInvalidations = defineInvalidations(testEndpoints, {
  fileUpload: ({ keys }) => [keys.nonAuthenticated()],
  streamOutput: () => [],
});
