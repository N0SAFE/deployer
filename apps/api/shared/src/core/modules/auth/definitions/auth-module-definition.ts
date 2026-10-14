import type { Auth } from "@/auth";
import { ConfigurableModuleBuilder } from "@nestjs/common";
import type { ApiMethodsWithAdminPlugin, platformBuilder } from "@repo/auth/permissions";

/**
 * Preserve Better Auth API as source-of-truth, then add permission plugin APIs on top.
 *
 * This keeps Better Auth method signatures intact (e.g. getSession) while exposing
 * admin permission APIs for DX.
 */
type PermissionApiExtras<TBaseApi extends object> =
	& Omit<ApiMethodsWithAdminPlugin<typeof platformBuilder>["api"], keyof TBaseApi>;

type WithPermissionApis<TAuth extends { api: object }> = Omit<TAuth, "api"> & {
	api: TAuth["api"] & PermissionApiExtras<TAuth["api"]>;
};

export type AuthWithPlugins = WithPermissionApis<Auth>;

export interface AuthModuleOptions<A extends AuthWithPlugins = Auth> {
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
