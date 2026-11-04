import "@orpc/effect/extensions/effect";

import { call, os } from "@orpc/server";
import { Context } from "effect";
import { describe, expect, it } from "vitest";

import { HttpRequest, currentRequest } from "@deployer/effect-core";

import { access } from "./authz";
import { procedure } from "./requirements";

const contract = os.meta(access({ public: true, reason: "probe" }));

describe("request in the effect context", () => {
	it("is readable from a handler without the module providing it", async () => {
		const handler = procedure(contract).effect(function* () {
			const request = yield* currentRequest;
			return { url: request._tag === "Some" ? request.value.url : "none" };
		});

		const context = {
			"effect/context": Context.add(Context.empty(), HttpRequest, {
				headers: {},
				method: "GET",
				url: "/probe",
			}),
		};

		await expect(call(handler, undefined, { context })).resolves.toEqual({ url: "/probe" });
	});

	it("answers `none` outside a request", async () => {
		const handler = procedure(contract).effect(function* () {
			const request = yield* currentRequest;
			return request._tag;
		});

		await expect(call(handler, undefined, { context: { "effect/context": Context.empty() } })).resolves.toBe("None");
	});
});
