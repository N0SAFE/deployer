export class RoleConfig {
    _role;
    constructor(_role) {
        this._role = _role;
    }
    all() {
        return this._role;
    }
    build() {
        return this._role;
    }
    get raw() {
        return this._role;
    }
    has(resource, action) {
        if (typeof this._role !== 'object' || this._role === null) {
            return false;
        }
        const roleObj = this._role;
        if (!(resource in roleObj)) {
            return false;
        }
        if (arguments.length === 1) {
            return true;
        }
        if (typeof action !== 'string') {
            return false;
        }
        const actions = roleObj[resource];
        return Array.isArray(actions) && actions.includes(action);
    }
    hasAll(permissions) {
        return permissions.every(({ resource, action }) => this.has(resource, action));
    }
    hasAny(permissions) {
        return permissions.some(({ resource, action }) => this.has(resource, action));
    }
    getPermissions(resource) {
        if (typeof this._role !== 'object' || this._role === null) {
            return [];
        }
        const roleObj = this._role;
        return roleObj[resource] ?? [];
    }
    getResources() {
        if (typeof this._role !== 'object' || this._role === null) {
            return [];
        }
        return Object.keys(this._role);
    }
    get isEmpty() {
        if (typeof this._role !== 'object' || this._role === null) {
            return true;
        }
        return Object.keys(this._role).length === 0;
    }
    get size() {
        if (typeof this._role !== 'object' || this._role === null) {
            return 0;
        }
        return Object.keys(this._role).length;
    }
    toObject() {
        return this._role;
    }
    equals(other) {
        return JSON.stringify(this._role) === JSON.stringify(other._role);
    }
    filter(predicate) {
        if (typeof this._role !== 'object' || this._role === null) {
            return new RoleConfig({});
        }
        const result = {};
        const roleObj = this._role;
        for (const [resource, actions] of Object.entries(roleObj)) {
            if (Array.isArray(actions) && predicate(resource, actions)) {
                result[resource] = actions;
            }
        }
        return new RoleConfig(result);
    }
    map(mapper) {
        if (typeof this._role !== 'object' || this._role === null) {
            return [];
        }
        const roleObj = this._role;
        return Object.entries(roleObj)
            .filter(([, actions]) => Array.isArray(actions))
            .map(([resource, actions]) => mapper(resource, actions));
    }
    readOnly() {
        return this.filter((_, actions) => actions.length === 1 && actions[0] === 'read');
    }
    writeOnly() {
        return this.filter((_, actions) => actions.some(a => ['create', 'update', 'delete'].includes(a)));
    }
    can(resource, action) {
        return this.has(resource, action);
    }
    cannot(resource, action) {
        return !this.has(resource, action);
    }
}
//# sourceMappingURL=single-role-config.js.map