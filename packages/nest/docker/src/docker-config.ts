/**
 * The configuration the docker primitives need, supplied BY THE APP.
 *
 * WHY NARROW CONTRACTS RATHER THAN AN ENV SERVICE
 * An earlier version injected the app's `EnvService`, which bound these
 * primitives to one app's environment surface: the package then had to import
 * the app to know what "the environment" even was, and a second Nest app could
 * not use it without inheriting those variables.
 *
 * Each primitive now declares the few values it actually reads, and the app
 * provides them from wherever it keeps config (its env schema, a settings row,
 * a test fixture). The package never reads an env var and never imports a
 * schema — see §8.7 for the rule.
 */

/** How to reach the Docker engine. */
export interface DockerConnectionConfig {
  /** `DOCKER_HOST`, e.g. `unix:///var/run/docker.sock` or `tcp://host:2375`. */
  readonly host: string | undefined;
  /** `DOCKER_PORT` — only meaningful when `host` is a TCP address. */
  readonly port: number | undefined;
}

/**
 * The scanner container's configuration.
 *
 * Defaults live with the CALLER (the app decides what a sensible default image
 * is for its deployment); the package only uses what it is given.
 */
export interface ScannerConfig {
  /** Image to run scans with. */
  readonly image: string;
  /** Build context used to build the image when it is missing. */
  readonly buildContext: string | undefined;
  /** Idle timeout before the shared scanner container is stopped. */
  readonly idleTimeoutMs: number;
  /** When true, automatic image scanning is disabled entirely. */
  readonly autoScanDisabled: boolean;
}

/**
 * The Postgres identity a provisioned database should use.
 *
 * Data only — the package does not decide where these come from.
 */
export interface PostgresIdentityConfig {
  readonly databaseName: string;
  readonly username: string;
  readonly password: string;
  readonly image: string;
}
