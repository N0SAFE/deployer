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

/**
 * The Postgres identity a provisioned database should use.
 *
 * Data only — the package does not decide where these come from.
 */
export type PostgresIdentityConfig = {
  readonly databaseName: string;
  readonly username: string;
  readonly password: string;
  readonly image: string;
}
