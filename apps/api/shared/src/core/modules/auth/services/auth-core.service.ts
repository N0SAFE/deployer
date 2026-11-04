import { Inject, Injectable } from "@nestjs/common";

import { AppError } from "@deployer/errors";

import {
	type AuthModuleOptions,
	type AuthWithPlugins,
	MODULE_OPTIONS_TOKEN,
} from "../definitions/auth-module-definition";
import { AuthUtils, AuthUtilsEmpty } from "../orpc/auth-utils";

import { type UserSession } from "../utils/auth-utils";

import type { Auth } from "../../../../auth";
import type { IncomingHttpHeaders } from "http";


/** Type for request-scoped headers. */
export type RequestHeaders = IncomingHttpHeaders | Record<string, string | string[]> | Headers;

/** Normalise the shapes Node and fetch hand us to one `Headers` (array values joined, per the HTTP spec). */
export function normalizeHeaders(headers: RequestHeaders): Headers {
	if (headers instanceof Headers) return headers;

	const result = new Headers();
	for (const [key, value] of Object.entries(headers)) {
		if (Array.isArray(value)) result.set(key, value.join(", "));
		else if (typeof value === "string") result.set(key, value);
	}
	return result;
}

/**
 * The Better Auth instance, as this process holds it.
 *
 * ── WHAT IS NOT HERE ANY MORE ───────────────────────────────────────────────
 * This used to be the home of a plugin registry, a Nest-guard converter and an oRPC middleware builder, all so a handler
 * could call `auth.api.*` / `admin.hasPermission(...)` itself. Every one of those is a SECOND authorization mechanism
 * beside the gate, and the platform decided to have one (`SEC-062`): the gate refuses before the handler runs, so a
 * handler that also checks is either redundant or — worse — different.
 *
 * What remains is what a transport boundary genuinely needs: the instance, `api`, the empty auth context, and the
 * contract-closed refusal.
 */
@Injectable()
export class AuthCoreService<T extends AuthWithPlugins = Auth> {
	private static latestModuleOptions: AuthModuleOptions | null = null;

	constructor(
		@Inject(MODULE_OPTIONS_TOKEN)
		private readonly options: AuthModuleOptions<T>,
	) {
		AuthCoreService.latestModuleOptions = this.options;
	}

	getModuleOptions(): AuthModuleOptions<T> {
		return this.options;
	}

	static getLatestModuleOptions(): AuthModuleOptions {
		if (!AuthCoreService.latestModuleOptions) {
			throw new AppError("AuthModuleOptions are not available yet.", "INTERNAL_ERROR");
		}

		return AuthCoreService.latestModuleOptions;
	}

	/** The Better Auth API endpoints. */
	get api(): T["api"] {
		return this.options.auth.api;
	}

	/** The whole Better Auth instance, for the rare caller that needs plugins it configured. */
	get instance(): T {
		return this.options.auth;
	}

	/** The auth context a request starts with, before the session is resolved. */
	createEmptyAuthUtils(): AuthUtilsEmpty {
		return new AuthUtilsEmpty();
	}

	/**
	 * The authenticated session, or the contract-closed `UNAUTHORIZED` refusal.
	 */
	requireAuth(session: UserSession | null): UserSession {
		return new AuthUtils(session).requireAuth();
	}

	/**
	 * Better Auth's OpenAPI schema, for the API document merge.
	 *
	 * The schema is static and needs no request headers. A build without the generator is an install problem, not a
	 * caller problem, which is why this is a 500 (`INTERNAL_ERROR`) rather than a refusal.
	 */
	generateAuthOpenAPISchema() {
		const api = this.options.auth.api as {
			generateOpenAPISchema?: (input: Record<string, never>) => unknown;
		};

		if (!api.generateOpenAPISchema) {
			throw new AppError(
				"Better Auth OpenAPI generator is not available on the configured auth instance.",
				"INTERNAL_ERROR",
			);
		}

		return api.generateOpenAPISchema({});
	}
}
