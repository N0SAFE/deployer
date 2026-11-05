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
 * The `.effect()` boundary supplies it from the call's own context, like `CurrentActor`: a handler that reads it needs no
 * provider, and overlapping requests cannot bleed.
 */
describe("request in the effect context", () => {
	it("is yielded by a handler without the module providing it", async () => {
		const handler = procedure(contract).effect(function* () {
			const request = yield* HttpRequest;
			return { url: request.url, method: request.method };
		});

		const context = {
			"effect/context": Context.empty(),
			request: { headers: {}, method: "GET", url: "/probe" },
		};

		await expect(call(handler, undefined, { context })).resolves.toEqual({ url: "/probe", method: "GET" });
	});

	it("is an empty POST when the call carries no request (a caller outside HTTP)", async () => {
		const handler = procedure(contract).effect(function* () {
			const request = yield* HttpRequest;
			return { url: request.url, method: request.method };
		});

		await expect(call(handler, undefined, { context: { "effect/context": Context.empty() } })).resolves.toEqual({ url: "", method: "POST" });
	});
});
