// Export core builder
export { PermissionBuilder, RoleBuilder } from './builder';

// Export base configuration class
export { BaseConfig } from './shared/base-config';

// Export statement configuration classes
export { StatementConfig } from './statements/single-statement-config';
export { StatementsConfig } from './statements/statements-config';
export { StatementConfigCollection } from './statements/statement-config-collection';

// Export role configuration classes
export { RoleConfig } from './roles/single-role-config';
export { RolesConfig } from './roles/roles-config';
export { RoleConfigCollection } from './roles/role-config-collection';

// Export types
export type {
  Permission,
  Resource,
  ResourceActions,
  ActionsForResource,
  RoleName,
  AuthenticatedUserType,
  CommonPermissionPattern,
  StrictPermission,
  RoleLevel,
  AllRoleNames,
  PermissionTypes,
} from './types';
