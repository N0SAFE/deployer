import { describe, expect, it } from "vitest";

import { SYSTEM_ROLES_TABLE, permissionsInRoles, type ScopeKind } from "@deployer/auth/authz";
import { accessOf } from "@deployer/auth/authz/meta";

import { projectServiceContract } from "../index";

// A contract procedure carries its definition under `~orpc`, with an `errorMap`; a router does not.
const isProcedure = (node: unknown): boolean =>
    typeof node === "object" && node !== null && "errorMap" in ((node as { "~orpc"?: object })["~orpc"] ?? {});

/** Every procedure of the router, by dotted path. A router is any node that is not itself a procedure. */
function procedures(node: unknown, path: string[] = []): [string, unknown][] {
    if (isProcedure(node)) return [[path.join("."), node]];
    if (node === null || typeof node !== "object") return [];
    return Object.entries(node).flatMap(([key, child]) => procedures(child, [...path, key]));
}

const all = procedures(projectServiceContract);
const get = (path: string) => accessOf(all.find(([p]) => p === path)?.[1]);

describe("project contract access declarations (AUTHZ-012)", () => {
    it("walks the router and finds the procedures", () => {
        expect(all.length).toBeGreaterThanOrEqual(60);
    });

    it("declares access on every procedure", () => {
        const undeclared = all.filter(([, procedure]) => accessOf(procedure) === undefined).map(([path]) => path);
        expect(undeclared).toEqual([]);
    });

    it("names no public or self procedure (every project route needs a permission)", () => {
        const open = all.filter(([, procedure]) => {
            const declaration = accessOf(procedure);
            return declaration !== undefined && ("self" in declaration || declaration.public === true);
        });
        expect(open.map(([path]) => path)).toEqual([]);
    });
});

/** Whether a role holds the permission a procedure declares, at the scope kind it declares. */
function allowed(role: string, path: string): boolean {
    const declaration = get(path);
    if (declaration === undefined || "self" in declaration || declaration.public === true) return false;
    const scope = declaration.scope;
    const declared: ScopeKind = scope === undefined ? "platform" : (scope.kind ?? "platform");
    // Project roles are checked at the project; a service/environment scope inherits from its project (AUTHZ-053).
    const kind: ScopeKind = declared === "service" || declared === "environment" ? "project" : declared;
    return permissionsInRoles(SYSTEM_ROLES_TABLE, role, kind).includes(declaration.permission);
}

describe("capability table for representative procedures", () => {
    // Project-scoped roles are checked at the scope kind the procedure declares; platform-only roles resolve to nothing there.
    const cases: [string, string, Partial<Record<string, boolean>>][] = [
        ["project.delete", "project:delete", { owner: true, maintainer: false, member: false }],
        ["project.inviteCollaborator", "member:invite", { owner: true, maintainer: false, member: false }],
        ["project.updateEnvironmentConfig", "env.var:write", { owner: true, maintainer: false, member: false }],
        ["project.findById", "project:read", { owner: true, maintainer: true, member: true }],
        ["service.crud.create", "service:create", { owner: true, maintainer: true, member: false }],
        ["service.crud.delete", "service:delete", { owner: true, maintainer: false, member: false }],
    ];

    it.each(cases)("%s declares %s", (path, permission, byRole) => {
        const declaration = get(path);
        expect(declaration && "permission" in declaration ? declaration.permission : undefined).toBe(permission);
        for (const [role, expected] of Object.entries(byRole)) {
            expect(allowed(role, path), `${role} on ${path}`).toBe(expected);
        }
    });
});
