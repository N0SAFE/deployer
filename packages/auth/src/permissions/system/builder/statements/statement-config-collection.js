import { StatementConfig } from './single-statement-config';
export class StatementConfigCollection {
    _statements;
    constructor(_statements) {
        this._statements = _statements;
    }
    all() {
        return this._statements;
    }
    build() {
        return this._statements;
    }
    pick(actions) {
        const result = {};
        for (const [key, config] of Object.entries(this._statements)) {
            const filteredActions = config.filter((action) => actions.includes(action));
            result[key] = filteredActions.length > 0 ? filteredActions : [];
        }
        return new StatementConfigCollection(result);
    }
    omit(actions) {
        const result = {};
        for (const [key, config] of Object.entries(this._statements)) {
            const remainingActions = config.filter((action) => !actions.includes(action));
            result[key] = remainingActions.length > 0 ? remainingActions : [];
        }
        return new StatementConfigCollection(result);
    }
    readOnly() {
        const result = {};
        for (const [resource, resourceActions] of Object.entries(this._statements)) {
            if (resourceActions.includes('read')) {
                result[resource] = ['read'];
            }
        }
        return new StatementConfigCollection(result);
    }
    writeOnly() {
        const result = {};
        const writeActions = ['create', 'update', 'delete'];
        for (const [resource, resourceActions] of Object.entries(this._statements)) {
            const filtered = resourceActions.filter(a => writeActions.includes(a));
            result[resource] = filtered;
        }
        return new StatementConfigCollection(result);
    }
    crudOnly() {
        const result = {};
        const crudActions = ['create', 'read', 'update', 'delete'];
        for (const [resource, resourceActions] of Object.entries(this._statements)) {
            const filtered = resourceActions.filter(a => crudActions.includes(a));
            if (filtered.length > 0) {
                result[resource] = filtered;
            }
        }
        return new StatementConfigCollection(result);
    }
    filter(predicate) {
        const result = {};
        for (const [resource, resourceActions] of Object.entries(this._statements)) {
            if (predicate(resource, resourceActions)) {
                result[resource] = resourceActions;
            }
        }
        return new StatementConfigCollection(result);
    }
    map(mapper) {
        return Object.entries(this._statements).map(([resource, actions]) => mapper(resource, new StatementConfig(actions)));
    }
    withAction(action) {
        const result = {};
        for (const [resource, resourceActions] of Object.entries(this._statements)) {
            if (resourceActions.includes(action)) {
                result[resource] = resourceActions;
            }
        }
        return new StatementConfigCollection(result);
    }
    withAllActions(actions) {
        const result = {};
        for (const [resource, resourceActions] of Object.entries(this._statements)) {
            if (actions.every(a => resourceActions.includes(a))) {
                result[resource] = resourceActions;
            }
        }
        return new StatementConfigCollection(result);
    }
    withAnyAction(actions) {
        const result = {};
        for (const [resource, resourceActions] of Object.entries(this._statements)) {
            if (actions.some(a => resourceActions.includes(a))) {
                result[resource] = resourceActions;
            }
        }
        return new StatementConfigCollection(result);
    }
    withoutAction(action) {
        const result = {};
        for (const [resource, resourceActions] of Object.entries(this._statements)) {
            if (!resourceActions.includes(action)) {
                result[resource] = resourceActions;
            }
        }
        return new StatementConfigCollection(result);
    }
    resources() {
        return Object.keys(this._statements);
    }
    get isEmpty() {
        return Object.keys(this._statements).length === 0;
    }
    get size() {
        return Object.keys(this._statements).length;
    }
    toObject() {
        return { ...this._statements };
    }
    getResource(key) {
        if (key in this._statements) {
            return new StatementConfig(this._statements[key]);
        }
        return undefined;
    }
    transform(transformer) {
        const result = {};
        for (const [resource, resourceActions] of Object.entries(this._statements)) {
            result[resource] = transformer(resource, new StatementConfig(resourceActions));
        }
        return result;
    }
    merge(other) {
        const otherObj = other instanceof StatementConfigCollection ? other.all() : other;
        return new StatementConfigCollection({
            ...this._statements,
            ...otherObj,
        });
    }
    compact() {
        const result = {};
        for (const [resource, resourceActions] of Object.entries(this._statements)) {
            if (resourceActions.length > 0) {
                result[resource] = resourceActions;
            }
        }
        return new StatementConfigCollection(result);
    }
}
//# sourceMappingURL=statement-config-collection.js.map