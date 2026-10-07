import { createAccessControl } from "better-auth/plugins/access";
import { BaseConfig } from "./shared/base-config";
import { StatementsConfig } from "./statements/statements-config";
import { RolesConfig } from "./roles/roles-config";
import { createSchemas } from "./schemas";
export class ResourceBuilder {
    builder;
    resourceName;
    constructor(builder, resourceName) {
        this.builder = builder;
        this.resourceName = resourceName;
    }
    actions(actions) {
        this.builder._statement[this.resourceName] = actions;
        return this.builder;
    }
}
export class RoleBuilderWithMeta {
    builder;
    roleName;
    constructor(builder, roleName) {
        this.builder = builder;
        this.roleName = roleName;
    }
    meta(data) {
        this.builder._roleMeta[this.roleName] = data;
        return this.builder;
    }
}
export class RoleBuilder {
    builder;
    roleName;
    ac;
    constructor(builder, roleName, ac) {
        this.builder = builder;
        this.roleName = roleName;
        this.ac = ac;
    }
    permissions(permissions) {
        this.builder._roles[this.roleName] = this.ac.newRole(permissions);
        if (this.builder._metaShape !== undefined) {
            return new RoleBuilderWithMeta(this.builder, this.roleName);
        }
        return this.builder;
    }
    allPermissions() {
        this.builder._roles[this.roleName] = this.ac.newRole(this.builder._statement);
        if (this.builder._metaShape !== undefined) {
            return new RoleBuilderWithMeta(this.builder, this.roleName);
        }
        return this.builder;
    }
}
export class InlineRoleEntry {
    __permissions;
    __meta;
    constructor(permissions) {
        this.__permissions = permissions;
    }
    meta(data) {
        this.__meta = data;
        return this;
    }
}
export class PermissionBuilder extends BaseConfig {
    _statement = {};
    _roles = {};
    _roleMeta = {};
    _metaShape;
    _ac;
    _statementsConfig;
    _rolesConfig;
    constructor(options) {
        super({});
        this._metaShape = (options?.metaShape ?? undefined);
    }
    static withDefaults(defaultRoles) {
        const builder = new PermissionBuilder();
        const allStatements = {};
        for (const [, role] of Object.entries(defaultRoles)) {
            Object.assign(allStatements, role.statements);
        }
        builder._statement = allStatements;
        const rolesStructure = {};
        for (const [roleName, role] of Object.entries(defaultRoles)) {
            rolesStructure[roleName] = role.statements;
        }
        Object.assign(builder._roles, rolesStructure);
        return builder;
    }
    resource(name) {
        return new ResourceBuilder(this, name);
    }
    resources(resourcesFactory) {
        const helpers = {
            actions: (actions) => actions
        };
        const resourceDefinitions = resourcesFactory(helpers);
        for (const [resourceName, actions] of Object.entries(resourceDefinitions)) {
            this._statement[resourceName] = actions;
        }
        return this;
    }
    role(name) {
        this._ac ??= createAccessControl(this._statement);
        return new RoleBuilder(this, name, this._ac);
    }
    roles(rolesFactory) {
        const permissionsHelper = (permissions) => {
            if (this._metaShape !== undefined) {
                return new InlineRoleEntry(permissions);
            }
            return permissions;
        };
        const helpers = {
            statement: this._statement,
            permissions: permissionsHelper,
        };
        const roleDefinitions = rolesFactory(helpers);
        this._ac ??= createAccessControl(this._statement);
        for (const [roleName, entry] of Object.entries(roleDefinitions)) {
            if (entry instanceof InlineRoleEntry) {
                this._roles[roleName] = this._ac.newRole(entry.__permissions);
                if (entry.__meta !== undefined) {
                    this._roleMeta[roleName] = entry.__meta;
                }
            }
            else {
                this._roles[roleName] = this._ac.newRole(entry);
            }
        }
        return this;
    }
    build() {
        this._ac = createAccessControl(this._statement);
        this._statementsConfig = new StatementsConfig(this._statement);
        this._rolesConfig = new RolesConfig(this._roles);
        const schemas = createSchemas(this);
        const result = {
            statementsConfig: this._statementsConfig,
            rolesConfig: this._rolesConfig,
            statement: this._statement,
            ac: this._ac,
            roles: this._roles,
            schemas,
            roleMeta: (this._metaShape !== undefined ? this._roleMeta : undefined),
        };
        return result;
    }
    getStatementsConfig() {
        return this._statementsConfig ??= new StatementsConfig(this._statement);
    }
    getRolesConfig() {
        return this._rolesConfig ??= new RolesConfig(this._roles);
    }
    getStatement() {
        return this._statement;
    }
    getAc() {
        return this._ac ??= createAccessControl(this._statement);
    }
    getRoles() {
        return this._roles;
    }
    getRoleMeta() {
        return (this._metaShape !== undefined ? this._roleMeta : undefined);
    }
    getRoleNames() {
        return Object.keys(this._roles);
    }
    getStatementNames() {
        return Object.keys(this._statement);
    }
    createPermission(permissions) {
        if (typeof permissions === 'function') {
            const ac = this.getAc();
            const statementsConfig = this.getStatementsConfig();
            const rolesConfig = this.getRolesConfig();
            return permissions({
                statementsConfig,
                rolesConfig,
                ac,
            }, this);
        }
        return permissions;
    }
    get statement() {
        return this._statement;
    }
}
export function createPermissionBuilder() {
    return new PermissionBuilder();
}
export function createPermissionBuilderWithDefaults(defaultRoles) {
    return PermissionBuilder.withDefaults(defaultRoles);
}
//# sourceMappingURL=builder.js.map