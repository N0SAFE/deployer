import { RoleConfig } from './single-role-config';
export class RoleConfigCollection {
    _roles;
    constructor(_roles) {
        this._roles = _roles;
    }
    all() {
        return this._roles;
    }
    getRole(key) {
        const role = this._roles[key];
        return role !== undefined ? new RoleConfig(role) : undefined;
    }
    withResource(resource) {
        const result = {};
        for (const [roleName, rolePerms] of Object.entries(this._roles)) {
            if (resource in rolePerms) {
                const resourceActions = rolePerms[resource];
                if (resourceActions) {
                    result[roleName] = { [resource]: resourceActions };
                }
            }
        }
        return new RoleConfigCollection(result);
    }
    withAction(action) {
        const result = {};
        for (const [roleName, rolePerms] of Object.entries(this._roles)) {
            const hasAction = Object.values(rolePerms).some((actions) => Array.isArray(actions) && actions.includes(action));
            if (hasAction) {
                result[roleName] = rolePerms;
            }
        }
        return new RoleConfigCollection(result);
    }
    withActionOnResource(resource, action) {
        const result = {};
        for (const [roleName, rolePerms] of Object.entries(this._roles)) {
            const resourceActions = rolePerms[resource];
            if (Array.isArray(resourceActions) && resourceActions.includes(action)) {
                result[roleName] = rolePerms;
            }
        }
        return new RoleConfigCollection(result);
    }
    withoutActionOnResource(resource, action) {
        const result = {};
        for (const [roleName, rolePerms] of Object.entries(this._roles)) {
            const resourceActions = rolePerms[resource];
            if (!Array.isArray(resourceActions) || !resourceActions.includes(action)) {
                result[roleName] = rolePerms;
            }
        }
        return new RoleConfigCollection(result);
    }
    withAllActionsOnResource(resource, actions) {
        const result = {};
        for (const [roleName, rolePerms] of Object.entries(this._roles)) {
            const resourceActions = rolePerms[resource];
            if (Array.isArray(resourceActions)) {
                const hasAllActions = actions.every(action => resourceActions.includes(action));
                if (hasAllActions) {
                    result[roleName] = rolePerms;
                }
            }
        }
        return new RoleConfigCollection(result);
    }
    withAnyActionOnResource(resource, actions) {
        const result = {};
        for (const [roleName, rolePerms] of Object.entries(this._roles)) {
            const resourceActions = rolePerms[resource];
            if (Array.isArray(resourceActions)) {
                const hasAnyAction = actions.some(action => resourceActions.includes(action));
                if (hasAnyAction) {
                    result[roleName] = rolePerms;
                }
            }
        }
        return new RoleConfigCollection(result);
    }
    withoutAction(action) {
        const result = {};
        for (const [roleName, rolePerms] of Object.entries(this._roles)) {
            const hasAction = Object.values(rolePerms).some((actions) => Array.isArray(actions) && actions.includes(action));
            if (!hasAction) {
                result[roleName] = rolePerms;
            }
        }
        return new RoleConfigCollection(result);
    }
    withoutResource(resource) {
        const result = {};
        for (const [roleName, rolePerms] of Object.entries(this._roles)) {
            if (!(resource in rolePerms)) {
                result[roleName] = rolePerms;
            }
        }
        return new RoleConfigCollection(result);
    }
    readOnly() {
        const result = {};
        for (const [roleName, rolePerms] of Object.entries(this._roles)) {
            const isReadOnly = Object.values(rolePerms).every((actions) => Array.isArray(actions) && actions.length === 1 && actions[0] === 'read');
            if (isReadOnly) {
                result[roleName] = rolePerms;
            }
        }
        return new RoleConfigCollection(result);
    }
    writeOnly() {
        const result = {};
        const writeActions = ['create', 'update', 'delete'];
        for (const [roleName, rolePerms] of Object.entries(this._roles)) {
            const hasWrite = Object.values(rolePerms).some((actions) => Array.isArray(actions) && actions.some(a => writeActions.includes(a)));
            if (hasWrite) {
                result[roleName] = rolePerms;
            }
        }
        return new RoleConfigCollection(result);
    }
    roleNames() {
        return Object.keys(this._roles);
    }
    get isEmpty() {
        return Object.keys(this._roles).length === 0;
    }
    get size() {
        return Object.keys(this._roles).length;
    }
    toObject() {
        return { ...this._roles };
    }
    filter(predicate) {
        const result = {};
        for (const [roleName, rolePerms] of Object.entries(this._roles)) {
            if (predicate(roleName, new RoleConfig(rolePerms))) {
                result[roleName] = rolePerms;
            }
        }
        return new RoleConfigCollection(result);
    }
    map(mapper) {
        return Object.entries(this._roles).map(([roleName, rolePerms]) => mapper(roleName, new RoleConfig(rolePerms)));
    }
    transform(transformer) {
        const result = {};
        for (const [roleName, rolePerms] of Object.entries(this._roles)) {
            result[roleName] = transformer(roleName, new RoleConfig(rolePerms));
        }
        return result;
    }
    merge(other) {
        return new RoleConfigCollection({
            ...this._roles,
            ...other.toObject()
        });
    }
    compact() {
        const result = {};
        for (const [roleName, rolePerms] of Object.entries(this._roles)) {
            if (Object.keys(rolePerms).length > 0) {
                result[roleName] = rolePerms;
            }
        }
        return new RoleConfigCollection(result);
    }
}
//# sourceMappingURL=role-config-collection.js.map