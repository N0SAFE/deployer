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
