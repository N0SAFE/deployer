/**
 * Better Auth adaptation of the authorization model.
 *
 * `authz` declares what a role may do; this area converts that model into Better Auth's access-control instance and
 * `Role` objects, and adds the pieces only Better Auth needs:
 *
 *   - `config`  — `platformAc`, `platformRoles`, schemas/meta, built FROM `authz/platform`.
 *   - `checks`  — `hasPermission`, `PermissionChecker`: runtime helpers over the converted roles.
 *   - `plugins` — the Nest/Better Auth plugin layer (permissions on the session, assertions, admin middleware).
 *
 * It never defines a permission or a role of its own.
 */
export * from "./config";
export * from "./checks";
export * from "./plugins/index";
