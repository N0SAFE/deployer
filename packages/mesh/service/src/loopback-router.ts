import { type AnyNestedClient, type ClientContext, createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { os } from "@orpc/server";

import { contractId } from "@deployer/mesh-client";
import { reviveDates } from "@deployer/service-client";

import type { RouterContract } from "@orpc/contract";

/** What the mesh hands a procedure: the caller's own headers, which carry its credentials. */
export type LoopbackContext = { readonly headers: Readonly<Record<string, string | string[] | undefined>> };

const isProcedure = (value: unknown): boolean =>
  (typeof value === "object" || typeof value === "function") && value !== null && "~orpc" in (value as Record<string, unknown>);

const outputSchemaAt = (contract: unknown, path: readonly string[]): unknown => {
  let node: unknown = contract;
  for (const key of path) {
    node = node !== null && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined;
  }
  return (node as { "~orpc"?: { outputSchemas?: unknown[] } } | undefined)?.["~orpc"]?.outputSchemas?.[0];
};

const flat = (headers: LoopbackContext["headers"]): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).flatMap(([name, value]) => (value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : value]])),
  );

/** The call's headers a service must not receive as they are: the transport's own, which describe a connection that is not this one. */
const HOP_HEADERS = new Set(["host", "connection", "upgrade", "content-length", "content-type", "accept", "accept-encoding", "transfer-encoding"]);
const credentials = (headers: LoopbackContext["headers"]) =>
  Object.fromEntries(Object.entries(flat(headers)).filter(([name]) => !HOP_HEADERS.has(name.toLowerCase())));

/**
 * A service's contracts, served over the mesh by calling the service's own HTTP surface on the loopback interface.
 *
 * The service already implements its contracts once, in its controllers, behind the pipeline that makes it what it is:
 * Better Auth resolving the session, the guards, the interceptors, the Effect context and the error mapping. Rebuilding
 * that pipeline for a second transport would be a second place for it to drift, so the mesh does not: each procedure of
 * each contract is mounted under the contract's id, and a call to it becomes the same call on `origin`, carrying the
 * caller's own headers. The persistent link is the mesh's (agent to replica, one websocket); the hop to the controller is
 * in-process.
 *
 * What comes back is what the service answered: its typed errors keep their code and data, dates are revived by the
 * contract's own output schema, and an event stream stays a stream.
 */
export function loopbackRouter(contracts: readonly RouterContract[], options: { readonly origin: string }) {
  const base = os.$context<LoopbackContext>();

  const mount = (contract: RouterContract) => {
    const client = createORPCClient<AnyNestedClient>(
      new OpenAPILink(contract, {
        url: options.origin,
        headers: ({ context }: { context: unknown }) => credentials((context as LoopbackContext).headers),
        interceptors: [],
        clientInterceptors: [],
      } as never),
      {
        interceptors: [
          async (call: { path: readonly string[]; next: () => Promise<unknown> }) => reviveDates(outputSchemaAt(contract, call.path), await call.next()),
        ],
      } as never,
    );

    const build = (node: unknown, path: readonly string[]): unknown => {
      if (isProcedure(node)) {
        return base.handler(async ({ input, context }) => {
          const procedure = path.reduce<unknown>((current, key) => (current as Record<string, unknown>)[key], client) as (
            input: unknown,
            options: { context: ClientContext },
          ) => Promise<unknown>;
          return procedure(input, { context: context });
        });
      }
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>)
          .filter(([key]) => key !== "~orpc")
          .map(([key, child]) => [key, build(child, [...path, key])]),
      );
    };

    return build(contract, []);
  };

  return Object.fromEntries(contracts.map((contract) => [contractId(contract), mount(contract)]));
}
