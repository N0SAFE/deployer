import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { BadRequestError, ForbiddenError, ValidationError } from "@deployer/errors";
import {
	DomainAlreadyExistsError,
	ProjectDomainNotFoundError,
	ServiceDomainMappingDeletionError,
	SubdomainNotAllowedError,
} from "@deployer/shared/core/modules/domain/errors/index";

import { ProjectConflict, ProjectForbidden, ProjectInvalid, ResourceMissing } from "./domain/project.errors";
import { attempt, rule, toFailure } from "./project-effects";
import { ProjectInfraFailure } from "./project.failures";

const failure = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(effect));

describe("rule", () => {
	it("returns the value when nothing throws", async () => {
		await expect(Effect.runPromise(rule(() => 7))).resolves.toBe(7);
	});

	it("turns a forbidden refusal into ProjectForbidden, keeping its sentence", async () => {
		const error = await failure(rule(() => { throw new ForbiddenError("only owners may do this"); }));
		expect(error).toBeInstanceOf(ProjectForbidden);
		expect((error as ProjectForbidden).publicMessage()).toBe("only owners may do this");
	});

	it("turns validation, bad-request and zod failures into ProjectInvalid", async () => {
		const thrown = [
			new ValidationError("bad", []),
			new BadRequestError("also bad"),
			(() => { try { z.string().parse(1); } catch (e) { return e; } })(),
		];
		for (const error of thrown) {
			const result = await failure(rule(() => { throw error; }));
			expect(result).toBeInstanceOf(ProjectInvalid);
		}
	});

	it("treats any other throw as a defect, not a refusal", async () => {
		const exit = await Effect.runPromiseExit(rule(() => { throw new Error("bug"); }));
		expect(Exit.isFailure(exit)).toBe(true);
		const flipped = await Effect.runPromiseExit(Effect.flip(rule(() => { throw new Error("bug"); })));
		expect(Exit.isFailure(flipped)).toBe(true);
	});
});

describe("attempt", () => {
	it("wraps a rejection as an infrastructure failure, not a domain error", async () => {
		const cause = new Error("db down");
		const error = await failure(attempt(() => Promise.reject(cause)));
		expect(error).toBeInstanceOf(ProjectInfraFailure);
		expect(error.cause).toBe(cause);
	});
});

describe("attempt and Nest exceptions", () => {
	it.each([
		["a 404", new NotFoundException("Project not found"), ResourceMissing],
		["a 403", new ForbiddenException("not yours"), ProjectForbidden],
		["a 409", new ConflictException("taken"), ProjectConflict],
	])("maps %s to its domain failure, keeping the message", async (_label, exception, Expected) => {
		const error = await failure(attempt(() => Promise.reject(exception)));
		expect(error).toBeInstanceOf(Expected);
		expect((error as ResourceMissing).publicMessage()).toBe(exception.message);
	});
});

describe("toFailure and the shared domain errors", () => {
	it("maps each family to its kind, keeping the shared message", () => {
		const missing = toFailure(new ProjectDomainNotFoundError("d1"));
		expect(missing).toBeInstanceOf(ResourceMissing);
		expect((missing as ResourceMissing).publicMessage()).toContain("d1");
		expect(toFailure(new DomainAlreadyExistsError("p1", "a.test"))).toBeInstanceOf(ProjectConflict);
		expect(toFailure(new SubdomainNotAllowedError("www", ["blog"]))).toBeInstanceOf(ProjectInvalid);
	});

	it("leaves a shared internal failure as infrastructure, not a client refusal", () => {
		expect(toFailure(new ServiceDomainMappingDeletionError("m1"))).toBeInstanceOf(ProjectInfraFailure);
	});
});
