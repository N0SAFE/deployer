import { BaseConfig } from '../shared/base-config';
import { StatementConfig } from './single-statement-config';
import { StatementConfigCollection } from './statement-config-collection';
export class StatementsConfig extends BaseConfig {
    get(key) {
        return new StatementConfig(this._value[key]);
    }
    getAll() {
        return new StatementConfigCollection(this._value);
    }
    build() {
        return this._value;
    }
    get raw() {
        return this._value;
    }
    add(resource, actions) {
        return new StatementsConfig({
            ...this._value,
            [resource]: actions,
        });
    }
    addMany(resources) {
        return new StatementsConfig({
            ...this._value,
            ...resources,
        });
    }
    getMany(resources) {
        const subset = {};
        for (const resource of resources) {
            if (resource in this._value) {
                subset[resource] = this._value[resource];
            }
        }
        return new StatementConfigCollection(subset);
    }
    has(resource) {
        return resource in this._value;
    }
    hasAction(resource, action) {
        const actions = this._value[resource];
        return actions ? actions.includes(action) : false;
    }
    omit(...resources) {
        const newStatement = { ...this._value };
        for (const resource of resources) {
            delete newStatement[resource];
        }
        return new StatementsConfig(newStatement);
    }
    pick(...resources) {
        const result = {};
        for (const resource of resources) {
            if (resource in this._value) {
                result[resource] = this._value[resource];
            }
        }
        return new StatementsConfig(result);
    }
    filter(predicate) {
        const result = {};
        for (const [resource, actions] of Object.entries(this._value)) {
            if (predicate(resource, actions)) {
                result[resource] = actions;
            }
        }
        return result;
    }
    map(mapper) {
        return Object.entries(this._value).map(([resource, actions]) => mapper(resource, actions));
    }
    merge(other) {
        return new StatementsConfig({
            ...this._value,
            ...other._value,
        });
    }
    update(resource, actions) {
        return new StatementsConfig({
            ...this._value,
            [resource]: actions,
        });
    }
    addActions(resource, ...actions) {
        const existing = this._value[resource];
        return new StatementsConfig({
            ...this._value,
            [resource]: [...existing, ...actions],
        });
    }
    removeActions(resource, ...actions) {
        const existing = this._value[resource];
        if (!existing) {
            return this;
        }
        const filtered = existing.filter(a => !actions.includes(a));
        return new StatementsConfig({
            ...this._value,
            [resource]: filtered,
        });
    }
    keys() {
        return Object.keys(this._value);
    }
    values() {
        return Object.values(this._value);
    }
    entries() {
        return Object.entries(this._value);
    }
    get isEmpty() {
        return Object.keys(this._value).length === 0;
    }
    get size() {
        return Object.keys(this._value).length;
    }
    verify() {
        const errors = [];
        for (const [resource, actions] of Object.entries(this._value)) {
            if (typeof resource !== 'string') {
                errors.push(`Invalid resource name: ${String(resource)}`);
            }
            if (!Array.isArray(actions)) {
                errors.push(`Actions for ${resource} must be an array`);
            }
            if (actions.length === 0) {
                errors.push(`Resource ${resource} has no actions`);
            }
            for (const action of actions) {
                if (typeof action !== 'string') {
                    errors.push(`Invalid action type for ${resource}: ${String(action)}`);
                }
            }
        }
        return {
            valid: errors.length === 0,
            errors,
        };
    }
    clone() {
        return new StatementsConfig({ ...this._value });
    }
}
//# sourceMappingURL=statements-config.js.map