export class StatementConfig {
    _actions;
    constructor(_actions) {
        this._actions = _actions;
    }
    all() {
        return this._actions;
    }
    none() {
        return [];
    }
    pick(actions) {
        const filtered = this._actions.filter(a => actions.includes(a));
        return new StatementConfig(filtered);
    }
    omit(actions) {
        const filtered = this._actions.filter((a) => !actions.includes(a));
        return new StatementConfig(filtered);
    }
    has(action) {
        return this._actions.includes(action);
    }
    hasAll(actions) {
        return actions.every(a => this._actions.includes(a));
    }
    hasAny(actions) {
        return actions.some(a => this._actions.includes(a));
    }
    filter(predicate) {
        return this._actions.filter(predicate);
    }
    map(mapper) {
        return this._actions.map(mapper);
    }
    first() {
        return this._actions[0];
    }
    last() {
        return this._actions[this._actions.length - 1];
    }
    at(index) {
        return this._actions[index];
    }
    includes(action) {
        return this._actions.includes(action);
    }
    indexOf(action) {
        return this._actions.indexOf(action);
    }
    get length() {
        return this._actions.length;
    }
    get isEmpty() {
        return this._actions.length === 0;
    }
    toArray() {
        return [...this._actions];
    }
    build() {
        return this._actions;
    }
    add(...actions) {
        return new StatementConfig([...this._actions, ...actions]);
    }
    concat(other) {
        return new StatementConfig([...this._actions, ...other._actions]);
    }
    unique() {
        return new StatementConfig(Array.from(new Set(this._actions)));
    }
    slice(start, end) {
        return new StatementConfig(this._actions.slice(start, end));
    }
    reverse() {
        return new StatementConfig([...this._actions].reverse());
    }
    sort(compareFn) {
        return new StatementConfig([...this._actions].sort(compareFn));
    }
    every(predicate) {
        return this._actions.every(predicate);
    }
    some(predicate) {
        return this._actions.some(predicate);
    }
    find(predicate) {
        return this._actions.find(predicate);
    }
    findIndex(predicate) {
        return this._actions.findIndex(predicate);
    }
    join(separator) {
        return this._actions.join(separator);
    }
    readOnly() {
        return this.has('read') ? ['read'] : [];
    }
    writeOnly() {
        return this.filter(a => ['create', 'update', 'delete'].includes(a));
    }
    withoutRead() {
        return this.filter(a => a !== 'read');
    }
    crudOnly() {
        return this.filter(a => ['create', 'read', 'update', 'delete'].includes(a));
    }
}
//# sourceMappingURL=single-statement-config.js.map