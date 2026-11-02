import { ConfigurableModuleBuilder } from "@nestjs/common";

import type { Auth } from "../../../../auth";

/**
 * The auth instance as the module receives it: Better Auth's own API.
 *
 * There is no admin-plugin API to graft on any more — user administration is the identity service's oRPC procedures, and
 * permissions are checked against `authz`.
 */
export type AuthWithPlugins = Auth;

export type AuthModuleOptions<A extends AuthWithPlugins = Auth> = {
	auth: A;
	disableTrustedOriginsCors?: boolean;
	disableBodyParser?: boolean;
	disableGlobalAuthGuard?: boolean;
};

export const MODULE_OPTIONS_TOKEN = Symbol("AUTH_MODULE_OPTIONS");

export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } =
	new ConfigurableModuleBuilder<AuthModuleOptions>({
		optionsInjectionToken: MODULE_OPTIONS_TOKEN,
	})
		.setClassMethodName("forRoot")
		.setExtras(
			{
				isGlobal: true,
				disableTrustedOriginsCors: false,
				disableBodyParser: false,
				disableGlobalAuthGuard: false,
			},
			(def, extras) => {
				return {
					...def,
					exports: [MODULE_OPTIONS_TOKEN],
					global: extras.isGlobal,
				};
			},
		)
		.build();
