import { BaseConfig } from '../shared/base-config';
import { RoleConfig } from './single-role-config';
import { RoleConfigCollection } from './role-config-collection';
export class RolesConfig extends BaseConfig {
    get(key) {
        return new RoleConfig(this._roles[key]);
    }
    getAll() {
        return new RoleConfigCollection(this._roles);
    }
    getMany(keys, asCollection) {
        if (asCollection) {
            const picked = {};
            for (const key of keys) {
                if (key in this._roles) {
                    picked[key] = this._roles[key];
                }
            }
            return new RoleConfigCollection(picked);
        }
        const result = {};
        for (const key of keys) {
            result[key] = new RoleConfig(this._roles[key]);
        }
        return result;
    }
    keys() {
        return Object.keys(this._roles);
    }
    values() {
        return Object.values(this._roles).map(role => new RoleConfig(role));
    }
    entries() {
        return Object.entries(this._roles).map(([key, role]) => [
            key,
            new RoleConfig(role)
        ]);
    }
    add(key, role) {
        return new RolesConfig({
            ...this._roles,
            [key]: role
        });
    }
    addMany(roles) {
        return new RolesConfig({
            ...this._roles,
            ...roles
        });
    }
    has(key) {
        return key in this._roles;
    }
    hasPermission(roleKey, resource, action) {
        if (!this.has(roleKey)) {
            return false;
        }
        return this.get(roleKey).has(resource, action);
    }
    omit(...keys) {
        const filtered = { ...this._roles };
        for (const key of keys) {
            delete filtered[key];
        }
        return new RolesConfig(filtered);
    }
    pick(...keys) {
        const picked = {};
        for (const key of keys) {
            if (key in this._roles) {
                picked[key] = this._roles[key];
            }
        }
        return new RolesConfig(picked);
    }
    filter(predicate) {
        const filtered = {};
        for (const [key, role] of Object.entries(this._roles)) {
            if (predicate(key, role)) {
                filtered[key] = role;
            }
        }
        return new RolesConfig(filtered);
    }
    map(mapper) {
        return Object.entries(this._roles).map(([key, role]) => mapper(key, role));
    }
    update(key, updater) {
        return new RolesConfig({
            ...this._roles,
            [key]: updater(this._roles[key])
        });
    }
    merge(other) {
        return new RolesConfig({
            ...this._roles,
            ...other.build()
        });
    }
    get isEmpty() {
        return Object.keys(this._roles).length === 0;
    }
    get size() {
        return Object.keys(this._roles).length;
    }
    find(predicate) {
        for (const [key, role] of Object.entries(this._roles)) {
            if (predicate(key, role)) {
                return [key, new RoleConfig(role)];
            }
        }
        return undefined;
    }
    every(predicate) {
        return Object.entries(this._roles).every(([key, role]) => predicate(key, role));
    }
    some(predicate) {
        return Object.entries(this._roles).some(([key, role]) => predicate(key, role));
    }
    toObject() {
        return { ...this._roles };
    }
    getRolesWithPermission(resource, action) {
        return this.keys().filter(key => this.get(key).has(resource, action));
    }
    getReadOnlyRoles() {
        return this.keys().filter(key => {
            const roleConfig = this.get(key);
            const resources = roleConfig.getResources();
            return resources.every(resource => {
                const permissions = roleConfig.getPermissions(resource);
                return permissions.length === 1 && permissions[0] === 'read';
            });
        });
    }
    getWriteRoles() {
        return this.keys().filter(key => {
            const roleConfig = this.get(key);
            const resources = roleConfig.getResources();
            return resources.some(resource => {
                const permissions = roleConfig.getPermissions(resource);
                return permissions.some(p => ['create', 'update', 'delete'].includes(p));
            });
        });
    }
    clone() {
        return new RolesConfig({ ...this._roles });
    }
    verify() {
        if (typeof this._roles !== 'object') {
            return false;
        }
        return Object.values(this._roles).every(role => typeof role === 'object');
    }
    build() {
        return this._roles;
    }
    get _roles() {
        return this._value;
    }
}
//# sourceMappingURL=roles-config.js.map