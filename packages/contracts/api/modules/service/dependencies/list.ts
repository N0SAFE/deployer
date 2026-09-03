import * as z from "zod";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";

/** A single dependency edge (own or sub-service). */
const dependencyEdgeSchema = z.object({
  id: z.uuid(),
  serviceId: z.uuid(),
  dependsOnServiceId: z.uuid(),
  dependsOnService: z.object({
    id: z.uuid(),
    name: z.string(),
    type: z.string(),
  }),
  isRequired: z.boolean(),
  // The API returns ISO-8601 strings, not Date objects.
  createdAt: z.string(),
});

/**
 * Namespace-aware dependency view.
 *
 * A service "is a namespace for everything below it": when you ask for the
 * dependencies of a main service you get:
 *  - `dependencies` — the service's OWN declared dependency edges.
 *  - `subServices` — one entry per direct sub-service, each with ITS OWN
 *    `dependencies` (+ its own sub-services recursively via `children`).
 *
 * This lets the UI render "main service deps" and drill into each
 * sub-service's deps in one request, so a sub-service can be a dependency
 * (edge) while its children's deps are visible under it.
 */
const serviceSubDependenciesNodeSchema = z.object({
  serviceId: z.uuid(),
  serviceName: z.string(),
  serviceType: z.string(),
  dependencies: z.array(dependencyEdgeSchema),
  get children() {
    return z.array(serviceSubDependenciesNodeSchema).optional();
  },
});

const serviceDependenciesListOutputSchema = z.object({
  dependencies: z.array(dependencyEdgeSchema),
  subServices: z.array(serviceSubDependenciesNodeSchema).default([]),
});

const serviceDependenciesListOps = standard.zod(serviceDependenciesListOutputSchema, "serviceDependenciesList");

export const serviceGetDependenciesContract = serviceDependenciesListOps
  .list()
  .summary("Get service dependencies (namespace-aware: includes sub-service deps)")
  // NOTE: the params MUST be declared with the path template form
  // (`p\`/${p("id", z.uuid())}/dependencies\``), NOT the schema-only
  // `.path("/:id/dependencies")` + `.input(params(schema))` combo — the
  // schema-only form does NOT wire the URL substitution in the OpenAPI
  // client, so requests went out as `/services/:id/dependencies` even with
  // a valid id (causing "Invalid UUID" 400s server-side).
  .input((b) => b.params((p) => p`/${p("id", z.uuid())}/dependencies`))
  .output(serviceDependenciesListOutputSchema)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
