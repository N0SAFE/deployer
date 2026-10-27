import path from "node:path";
import { createServiceTestConfig } from "@deployer/config-vitest/service";

export default createServiceTestConfig({
  service: "identity",
  extraAliases: [{ find: "@identity", replacement: path.resolve(import.meta.dirname, "src") }],
});
