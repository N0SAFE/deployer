import { Context, Effect } from "effect";

import { DomainStorageFailure } from "./errors";

import type { GlobalDatabase } from "../database/global/global-database.service";
import type { TraefikRepository } from "../traefik/repositories/traefik.repository";
import type { TraefikSyncService } from "../traefik/services/traefik-sync.service";
import type { TraefikVariableResolverService } from "../traefik/services/traefik-variable-resolver.service";
import type { TraefikService } from "../traefik/services/traefik.service";

/** The platform database, as the domain module sees it. Bound to the container's database by `CoreDomainModule`. */
export class DomainDatabase extends Context.Service<DomainDatabase, { readonly db: GlobalDatabase }>()(
  "shared/DomainDatabase",
) {}

/** Run one Promise-based query; any rejection is a `DomainStorageFailure` whose cause stays server-side. */
export function storage<A>(
  database: { readonly db: GlobalDatabase },
  run: (db: GlobalDatabase) => Promise<A>,
): Effect.Effect<A, DomainStorageFailure> {
  return Effect.tryPromise({ try: () => run(database.db), catch: (cause) => new DomainStorageFailure({ cause }) });
}

/**
 * The Traefik collaborators of route sync. They are still Promise-based providers of the traefik module, so each is a
 * port over exactly the methods the domain module calls; `CoreDomainModule` binds them with `useExisting`.
 */
export type RoutingTraefikRepositoryShape = Pick<
  TraefikRepository,
  | "getServiceConfigByServiceId"
  | "createServiceConfig"
  | "updateServiceConfig"
  | "getDomainRoutesByConfigId"
  | "createDomainRoute"
  | "updateDomainRoute"
  | "getSSLCertificatesByConfigId"
>;
export class RoutingTraefikRepository extends Context.Service<RoutingTraefikRepository, RoutingTraefikRepositoryShape>()(
  "shared/RoutingTraefikRepository",
) {}

export class RoutingTraefikSync extends Context.Service<RoutingTraefikSync, Pick<TraefikSyncService, "syncServiceConfiguration">>()(
  "shared/RoutingTraefikSync",
) {}

export class RoutingTraefikCertificates extends Context.Service<RoutingTraefikCertificates, Pick<TraefikService, "addSSLCertificate">>()(
  "shared/RoutingTraefikCertificates",
) {}

export class RoutingTraefikVariables extends Context.Service<RoutingTraefikVariables, Pick<TraefikVariableResolverService, "buildVariableMap">>()(
  "shared/RoutingTraefikVariables",
) {}
