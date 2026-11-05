/**
 * Better Auth adaptation of the authorization model.
 *
 * `authz` declares what a role may do; this area converts that model into Better Auth's access-control instance and
 * `Role` objects, and adds the pieces only Better Auth needs:
 *
 *   - `config`  — `platformAc`, `platformRoles`, schemas/meta, built FROM `authz/platform`.
 *
 * It never defines a permission or a role of its own.
 */
export * from './config'
