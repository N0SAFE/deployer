/**
 * IngressLanesService — the stack's lanes, stored in the MESH.
 *
 * The lanes are a cluster-wide fact, so they live in the replicated cluster settings (`ingress.lanes`) rather than in one
 * node's SQLite: the API is a replicated swarm service that can be rescheduled to any node, and a setting that lives on the
 * node it happened to start on is lost the moment it moves.
 *
 * When there is no cluster store yet (a node mid-onboarding, before setup started its agent) the lanes read as the install
 * default — local only — which is the one answer that can never expose the machine. Writes fail loudly instead: an operator's
 * choice must never be silently dropped.
 *
 * This service stores lanes; it does not judge them. Checking a public lane against its edge provider is the registry's job
 * (`EdgeProviderRegistry.normalize`), done by whoever accepts the operator's input.
 */

import { Context, Effect } from "effect";

import { defaultIngressLanes, ingressLanesSchema, type IngressLanes } from "@deployer/contracts-entities/entities/ingress/index";

import { IngressLanesUnavailable } from "../platform-ingress.errors";

import type { ClusterSettings } from "../../mesh-node/cluster-settings";

export const INGRESS_LANES_SETTING = "ingress.lanes";

export type IngressLanesServiceShape = {
	/** The lanes in effect: the replicated setting, else local-only. */
	readonly getLanes: () => Effect.Effect<IngressLanes, IngressLanesUnavailable>;
	readonly setLanes: (next: IngressLanes) => Effect.Effect<IngressLanes, IngressLanesUnavailable>;
};

type Ports = {
	/** The cluster settings are still a Promise-based provider of the mesh-node module. */
	readonly settings: Pick<ClusterSettings, "read" | "write">;
	/** `DEPLOYER_TRAEFIK_HTTP_PORT`: the entry port of the install-default lanes. */
	readonly entryPort: () => number;
};

export function makeIngressLanesService({ settings, entryPort }: Ports): IngressLanesServiceShape {
	const lift = <A>(operation: string, run: () => Promise<A>) =>
		Effect.tryPromise({ try: run, catch: (cause) => new IngressLanesUnavailable({ operation, cause }) });

	return {
		getLanes: () => lift("read", () => settings.read(INGRESS_LANES_SETTING, ingressLanesSchema, defaultIngressLanes(entryPort()))),

		setLanes: (next) =>
			lift("written", () => settings.write(INGRESS_LANES_SETTING, next)).pipe(
				Effect.andThen(
					Effect.logInfo(
						`Ingress lanes set — local${next.private.enabled ? ` + private (${next.private.domain})` : ""}${
							next.public === null ? "" : ` + public via ${next.public.provider} (${next.public.domain})`
						}`,
					),
				),
				Effect.as(next),
			),
	};
}

export class IngressLanesService extends Context.Service<IngressLanesService, IngressLanesServiceShape>()("shared/IngressLanesService") {}
