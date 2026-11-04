import "@orpc/effect/extensions/effect";

import { call, os } from "@orpc/server";
import { Context } from "effect";
import { describe, expect, it } from "vitest";

import { HttpRequest } from "@deployer/effect-core";

import { access } from "./authz";
import { procedure } from "./requirements";

const contract = os.meta(access({ public: true, reason: "probe" }));

/**
 * The request is part of the Effect context, per call (`AUTH-0xx`).
 *
 * It is REQUIRED, like `CurrentActor`: a handler that reads it says so in its type, and the boundary supplies it. That is
 * the whole advantage over `Scope.REQUEST` — no provider graph rebuild, and overlapping requests cannot bleed.
 */
describe("request in the effect context", () => {
	it("is yielded by a handler without the module providing it", async () => {
		const handler = procedure(contract).effect(function* () {
			const request = yield* HttpRequest;
			return { url: request.url, method: request.method };
		});

		const context = {
			"effect/context": Context.add(Context.empty(), HttpRequest, {
				headers: {},
				method: "GET",
				url: "/probe",
			}),
		};

		await expect(call(handler, undefined, { context })).resolves.toEqual({ url: "/probe", method: "GET" });
	});

	it("is a missing REQUIREMENT when nothing supplied one", async () => {
		const handler = procedure(contract).effect(function* () {
			const request = yield* HttpRequest;
			return request.url;
		});

		// No `Context.add`: the call dies with the service-not-found defect rather than inventing a request. A caller
		// outside HTTP supplies `systemRequest`, which is the explicit way to say "there is no caller".
		await expect(
			call(handler, undefined, { context: { "effect/context": Context.empty() } }),
		).rejects.toThrow(/HttpRequest|http\/Request/);
	});
});
