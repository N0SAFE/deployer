import * as z from 'zod';
function assertDefined(value, context) {
    if (value === undefined) {
        throw new Error(`Unexpected undefined value: ${context}`);
    }
    return value;
}
export function createSchemas(builder) {
    const statement = builder.getStatement();
    const roles = builder.getRoles();
    const getStatements = (role) => {
        if ('statements' in role && typeof role.statements === 'object') {
            return role.statements;
        }
        return role;
    };
    const roleKeys = Object.keys(roles).filter(roleName => {
        const role = roles[roleName];
        const rolePerms = getStatements(role);
        return Object.values(rolePerms).some((actions) => {
            const actionsArr = Array.isArray(actions) ? actions : Array.from(actions);
            return actionsArr.length > 0;
        });
    });
    const roleNamesSchema = (() => {
        if (roleKeys.length === 0)
            return z.never();
        const first = roleKeys[0];
        if (first === undefined)
            return z.never();
        if (roleKeys.length === 1)
            return z.literal(first);
        const second = roleKeys[1];
        if (second === undefined)
            return z.literal(first);
        return z.union([
            z.literal(first),
            z.literal(second),
            ...roleKeys.slice(2).map(k => z.literal(k))
        ]);
    })();
    const resourceNamesArray = Object.keys(statement).filter(key => {
        const actions = statement[key];
        if (actions === undefined)
            return false;
        return actions.length > 0;
    });
    const resourceNamesSchema = resourceNamesArray.length === 0 ? z.never() :
        resourceNamesArray.length === 1 ? z.literal(assertDefined(resourceNamesArray[0], 'resourceNamesArray[0]')) :
            z.union([
                z.literal(assertDefined(resourceNamesArray[0], 'resourceNamesArray[0]')),
                z.literal(assertDefined(resourceNamesArray[1], 'resourceNamesArray[1]')),
                ...resourceNamesArray.slice(2).map(r => z.literal(r))
            ]);
    const allActionsSet = new Set();
    for (const actions of Object.values(statement)) {
        for (const action of actions) {
            allActionsSet.add(action);
        }
    }
    const allActionsArray = Array.from(allActionsSet);
    const allActionsSchema = allActionsArray.length === 0 ? z.never() :
        allActionsArray.length === 1 ? z.literal(allActionsArray[0]) :
            z.union([
                z.literal(allActionsArray[0]),
                z.literal(allActionsArray[1]),
                ...allActionsArray.slice(2).map(a => z.literal(a))
            ]);
    const actionsByResource = {};
    for (const [resource, actions] of Object.entries(statement)) {
        if (actions.length === 0)
            continue;
        const actionsArray = [...actions];
        actionsByResource[resource] = (actionsArray.length === 0 ? z.never() :
            actionsArray.length === 1 ? z.literal(actionsArray[0]) :
                z.union([
                    z.literal(actionsArray[0]),
                    z.literal(actionsArray[1]),
                    ...actionsArray.slice(2).map(a => z.literal(a))
                ]));
    }
    const permissionShape = {};
    for (const [resource, actionSchema] of Object.entries(actionsByResource)) {
        permissionShape[resource] = z.array(actionSchema).optional();
    }
    const permissionSchema = z.object(permissionShape);
    const rolePermissionSchemas = {};
    for (const [roleName, role] of Object.entries(roles)) {
        const rolePerms = getStatements(role);
        const hasPermissions = Object.values(rolePerms).some((actions) => {
            const actionsArray = Array.isArray(actions) ? actions : Array.from(actions);
            return actionsArray.length > 0;
        });
        if (!hasPermissions)
            continue;
        const shape = {};
        for (const [resource, actions] of Object.entries(rolePerms)) {
            const actionsArray = Array.isArray(actions) ? [...actions] : Array.from(actions);
            if (actionsArray.length === 0)
                continue;
            const actionSchema = (actionsArray.length === 1 ? z.literal(actionsArray[0]) :
                z.union([
                    z.literal(actionsArray[0]),
                    z.literal(actionsArray[1]),
                    ...actionsArray.slice(2).map(a => z.literal(a))
                ]));
            shape[resource] = z.array(actionSchema).optional();
        }
        rolePermissionSchemas[roleName] = z.object(shape);
    }
    const resourceActionSchema = z.object({
        resource: resourceNamesSchema,
        action: allActionsSchema,
    });
    return {
        roleNames: roleNamesSchema,
        resourceNames: resourceNamesSchema,
        allActions: allActionsSchema,
        actionsByResource,
        permission: permissionSchema,
        rolePermissions: rolePermissionSchemas,
        resourceAction: resourceActionSchema,
        actions: {
            forResource(resource) {
                return assertDefined(actionsByResource[resource], `schema for resource ${String(resource)}`);
            },
            forResources(...resources) {
                const schemas = resources.map(r => assertDefined(actionsByResource[r], `schema for resource ${String(r)}`));
                if (schemas.length === 0)
                    return z.never();
                const first = assertDefined(schemas[0], 'schemas[0]');
                if (schemas.length === 1)
                    return first;
                return z.union(schemas);
            },
            forRoleOnResource(role, resource) {
                const rolePerms = roles[role];
                const resourceKey = resource;
                const rolePermsRecord = ('statements' in rolePerms && typeof rolePerms.statements === 'object')
                    ? rolePerms.statements
                    : rolePerms;
                const actions = rolePermsRecord[resourceKey];
                if (!actions || actions.length === 0)
                    return z.never();
                const firstAction = actions[0];
                if (firstAction === undefined)
                    return z.never();
                if (actions.length === 1)
                    return z.literal(firstAction);
                return z.union([
                    z.literal(firstAction),
                    ...actions.slice(1).map((a) => z.literal(a))
                ]);
            },
            forRole(role) {
                const rolePerms = roles[role];
                const rolePermsRecord = ('statements' in rolePerms && typeof rolePerms.statements === 'object')
                    ? rolePerms.statements
                    : rolePerms;
                const allRoleActions = new Set();
                for (const actions of Object.values(rolePermsRecord)) {
                    if ((Array.isArray(actions) && actions.length === 0))
                        continue;
                    const actionsArray = Array.isArray(actions) ? actions : Array.from(actions);
                    for (const action of actionsArray) {
                        allRoleActions.add(action);
                    }
                }
                const actionsArray = Array.from(allRoleActions);
                if (actionsArray.length === 0)
                    return z.never();
                const first = actionsArray[0];
                if (first === undefined)
                    return z.never();
                if (actionsArray.length === 1)
                    return z.literal(first);
                return z.union([
                    z.literal(first),
                    ...actionsArray.slice(1).map(a => z.literal(a))
                ]);
            },
            filter(predicate) {
                const filteredActions = new Set();
                for (const [resource, actions] of Object.entries(statement)) {
                    for (const action of actions) {
                        if (predicate(action, resource)) {
                            filteredActions.add(action);
                        }
                    }
                }
                const actionsArray = Array.from(filteredActions);
                if (actionsArray.length === 0)
                    return z.never();
                if (actionsArray.length === 1)
                    return z.literal(actionsArray[0]);
                return z.union([
                    z.literal(actionsArray[0]),
                    ...actionsArray.slice(1).map(a => z.literal(a))
                ]);
            },
            commonTo(...resources) {
                if (resources.length === 0)
                    return z.never();
                const actionSets = resources.map(r => new Set(statement[r]));
                const firstSet = actionSets[0];
                if (!firstSet)
                    return z.never();
                const commonActions = Array.from(firstSet).filter(action => actionSets.every(set => set.has(action)));
                if (commonActions.length === 0)
                    return z.never();
                const first = commonActions[0];
                if (first === undefined)
                    return z.never();
                if (commonActions.length === 1)
                    return z.literal(first);
                return z.union([
                    z.literal(first),
                    ...commonActions.slice(1).map(a => z.literal(a))
                ]);
            },
            excluding(...excludedActions) {
                const excluded = new Set(excludedActions);
                const filteredActions = allActionsArray.filter(a => !excluded.has(a));
                if (filteredActions.length === 0)
                    return z.never();
                if (filteredActions.length === 1)
                    return z.literal(filteredActions[0]);
                return z.union([
                    z.literal(filteredActions[0]),
                    ...filteredActions.slice(1).map(a => z.literal(a))
                ]);
            },
            only(...actions) {
                if (actions.length === 0)
                    return z.never();
                const first = actions[0];
                if (first === undefined)
                    return z.never();
                if (actions.length === 1)
                    return z.literal(first);
                return z.union([
                    z.literal(first),
                    ...actions.slice(1).map(a => z.literal(a))
                ]);
            },
            customPermission(resourceActions) {
                const shape = {};
                for (const [resource, actions] of Object.entries(resourceActions)) {
                    const actionsArray = actions;
                    if (!actionsArray || actionsArray.length === 0)
                        continue;
                    const arr = [...actionsArray];
                    const actionSchema = (arr.length === 1 ? z.literal(arr[0]) :
                        z.union([
                            z.literal(arr[0]),
                            ...arr.slice(1).map((a) => z.literal(a))
                        ]));
                    shape[resource] = z.array(actionSchema).optional();
                }
                return z.object(shape);
            },
        },
    };
}
//# sourceMappingURL=schemas.js.map