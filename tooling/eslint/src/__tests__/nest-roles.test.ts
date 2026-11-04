import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

import { createNestRoleRules, NEST_ROLE_RULE_NAMES, NEST_ROLE_SPECS, type NestRoleRuleName } from "../rules/nest-roles";

const rules = createNestRoleRules();

function lint(rule: NestRoleRuleName, code: string) {
	return new Linter().verify(
		code,
		[
			{
				files: ["**/*.ts"],
				languageOptions: { parser: tseslint.parser },
				plugins: { local: { rules } },
				rules: { [`local/${rule}`]: "error" },
			},
		],
		{ filename: "x.ts" },
	);
}

const hits = (rule: NestRoleRuleName, code: string) => lint(rule, code).map((m) => m.message.match(/`([^`]+)`/)?.[1]);

describe("nest role rules", () => {
	it("is exactly one rule per concept", () => {
		expect(NEST_ROLE_RULE_NAMES.sort()).toEqual(
			["noNestExceptionFilter", "noNestGateway", "noNestGuard", "noNestInterceptor", "noNestLifecycleHook", "noNestMiddleware", "noNestPipe", "noNestRequestScope", "noPassport"].sort(),
		);
	});

	it("every message names the replacement and points at the guide", () => {
		for (const name of NEST_ROLE_RULE_NAMES) {
			const message = rules[name].meta?.messages?.nestRole ?? "";
			expect(message, name).toContain("docs/architecture/effect-orpc-conventions.md");
			expect(message.length, name).toBeGreaterThan(80);
		}
	});

	describe("noNestLifecycleHook", () => {
		it("flags each hook interface, value or type import", () => {
			const code = `import { OnModuleInit, OnModuleDestroy, type OnApplicationShutdown } from "@nestjs/common";`;
			expect(hits("noNestLifecycleHook", code)).toEqual(["OnModuleInit", "OnModuleDestroy", "OnApplicationShutdown"]);
		});
		it("ignores other Nest imports", () => {
			expect(lint("noNestLifecycleHook", `import { Module, Logger } from "@nestjs/common";`)).toEqual([]);
		});
	});

	describe("noNestGuard", () => {
		it("flags the decorator, the interface and the global token", () => {
			expect(hits("noNestGuard", `import { UseGuards, CanActivate } from "@nestjs/common";`)).toEqual(["UseGuards", "CanActivate"]);
			expect(hits("noNestGuard", `import { APP_GUARD } from "@nestjs/core";`)).toEqual(["APP_GUARD"]);
		});
		it("does not confuse an unrelated package that exports the same name", () => {
			expect(lint("noNestGuard", `import { CanActivate } from "some-other-lib";`)).toEqual([]);
		});
	});

	describe("noPassport", () => {
		it("flags the whole package, however it is imported", () => {
			expect(hits("noPassport", `import { PassportStrategy } from "@nestjs/passport";`)).toEqual(["@nestjs/passport"]);
			expect(hits("noPassport", `import { Strategy } from "passport-jwt";`)).toEqual(["passport-jwt"]);
			expect(hits("noPassport", `import passport from "passport";`)).toEqual(["passport"]);
			expect(hits("noPassport", `import "@nestjs/passport";`)).toEqual(["@nestjs/passport"]);
		});
		it("ignores a package that merely starts with the word", () => {
			expect(lint("noPassport", `import x from "passport-like-but-not";`).length).toBe(1); // `passport-*` is the family
			expect(lint("noPassport", `import x from "passportal";`)).toEqual([]);
		});
	});

	describe("noNestPipe", () => {
		it("flags pipes and the global token", () => {
			expect(hits("noNestPipe", `import { UsePipes, ValidationPipe, ParseIntPipe, PipeTransform } from "@nestjs/common";`)).toEqual(["UsePipes", "ValidationPipe", "ParseIntPipe", "PipeTransform"]);
			expect(hits("noNestPipe", `import { APP_PIPE } from "@nestjs/core";`)).toEqual(["APP_PIPE"]);
		});
		it("does not flag oRPC's unrelated `ObservablePipeTransform`", () => {
			expect(lint("noNestPipe", `import { type ObservablePipeTransform } from "@deployer/orpc-utils";`)).toEqual([]);
		});
	});

	describe("noNestInterceptor", () => {
		it("flags decorator, interface, call handler and token", () => {
			expect(hits("noNestInterceptor", `import { UseInterceptors, NestInterceptor, CallHandler } from "@nestjs/common";`)).toEqual(["UseInterceptors", "NestInterceptor", "CallHandler"]);
			expect(hits("noNestInterceptor", `import { APP_INTERCEPTOR } from "@nestjs/core";`)).toEqual(["APP_INTERCEPTOR"]);
		});
	});

	describe("noNestExceptionFilter", () => {
		it("flags filters and the built-in HTTP exceptions", () => {
			expect(hits("noNestExceptionFilter", `import { Catch, ExceptionFilter, NotFoundException, HttpException } from "@nestjs/common";`)).toEqual(["Catch", "ExceptionFilter", "NotFoundException", "HttpException"]);
			expect(hits("noNestExceptionFilter", `import { APP_FILTER, BaseExceptionFilter } from "@nestjs/core";`)).toEqual(["APP_FILTER", "BaseExceptionFilter"]);
		});
		it("every exception class Nest ships is covered", () => {
			const listed = new Set(NEST_ROLE_SPECS.noNestExceptionFilter.sources[0]?.names);
			for (const name of ["BadRequestException", "UnauthorizedException", "ForbiddenException", "ConflictException", "InternalServerErrorException", "ServiceUnavailableException"]) {
				expect(listed.has(name), name).toBe(true);
			}
		});
	});

	describe("noNestMiddleware", () => {
		it("flags the interface, the consumer and the module hook", () => {
			expect(hits("noNestMiddleware", `import { NestMiddleware, MiddlewareConsumer, NestModule } from "@nestjs/common";`)).toEqual(["NestMiddleware", "MiddlewareConsumer", "NestModule"]);
		});
		it("points at the HTTP edge", () => {
			expect(lint("noNestMiddleware", `import { NestMiddleware } from "@nestjs/common";`)[0]?.message).toContain("mountHttpEdge");
		});
	});

	describe("noNestRequestScope", () => {
		it("flags Scope and the request tokens", () => {
			expect(hits("noNestRequestScope", `import { Scope } from "@nestjs/common";`)).toEqual(["Scope"]);
			expect(hits("noNestRequestScope", `import { REQUEST, INQUIRER } from "@nestjs/core";`)).toEqual(["REQUEST", "INQUIRER"]);
		});
	});

	describe("noNestGateway", () => {
		it("flags any import from the websocket packages", () => {
			expect(hits("noNestGateway", `import { WebSocketGateway, SubscribeMessage } from "@nestjs/websockets";`)).toEqual(["@nestjs/websockets"]);
			expect(hits("noNestGateway", `import { IoAdapter } from "@nestjs/platform-socket.io";`)).toEqual(["@nestjs/platform-socket.io"]);
		});
	});

	it("reports an aliased import by its original name", () => {
		expect(hits("noNestGuard", `import { CanActivate as Can } from "@nestjs/common";`)).toEqual(["CanActivate"]);
	});
});
