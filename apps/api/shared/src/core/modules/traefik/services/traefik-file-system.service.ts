import * as crypto from "crypto";
import { join } from "path";

import { Context } from "effect";

import type { TraefikFileSystemPaths } from "../interfaces";

/**
 * Where Traefik's dynamic configuration lives and how its files are named.
 *
 * Pure: the paths come from two environment values read once when the service is built, and every method is synchronous.
 * (The database-backed "virtual filesystem" that used to live here was never called by anything and was removed with the
 * migration; `git log -- traefik-file-system.service.ts` has it.)
 */
export type TraefikFileSystemShape = {
  readonly getFileSystemPaths: () => TraefikFileSystemPaths;
  /** Config path of a service: under its project's folder, or `standalone` without a project. */
  readonly generateServiceConfigPath: (serviceId: string, configId: string, projectName?: string) => string;
  readonly generateServiceConfigFileName: (serviceId: string, configId: string) => string;
  readonly calculateChecksum: (content: string) => string;
  /** Re-root every path. Only the e2e harness calls it (to point a shared runtime at its own temp directories). */
  readonly setBasePaths: (env: { readonly basePath: string; readonly backupPath: string }) => void;
};

const SERVICE_CONFIG_PREFIX = "service";
const FILE_EXTENSION = "yml";

const pathsFor = ({ basePath, backupPath }: { readonly basePath: string; readonly backupPath: string }): TraefikFileSystemPaths => ({
  basePath,
  dynamicPath: join(basePath, "dynamic"),
  staticPath: join(basePath, "static"),
  projectsPath: join(basePath, "dynamic", "projects"),
  standalonePath: join(basePath, "dynamic", "standalone"),
  sslPath: join(basePath, "ssl"),
  certsPath: join(basePath, "certs"),
  middlewarePath: join(basePath, "middleware"),
  pluginsPath: join(basePath, "plugins"),
  backupPath,
});

export function makeTraefikFileSystem(env: { readonly basePath: string; readonly backupPath: string }): TraefikFileSystemShape {
  let paths = pathsFor(env);

  const generateServiceConfigFileName = (serviceId: string, configId: string): string =>
    `${SERVICE_CONFIG_PREFIX}-${serviceId.slice(0, 8)}-${configId.slice(0, 8)}.${FILE_EXTENSION}`;

  return {
    getFileSystemPaths: () => ({ ...paths }),
    generateServiceConfigFileName,
    generateServiceConfigPath: (serviceId, configId, projectName) => {
      const fileName = generateServiceConfigFileName(serviceId, configId);
      return projectName ? join(paths.projectsPath, projectName, fileName) : join(paths.standalonePath, fileName);
    },
    setBasePaths: (next) => {
      paths = pathsFor(next);
    },
    calculateChecksum: (content) => crypto.createHash("sha256").update(content, "utf8").digest("hex"),
  };
}

export class TraefikFileSystemService extends Context.Service<TraefikFileSystemService, TraefikFileSystemShape>()(
  "shared/TraefikFileSystemService",
) {}
