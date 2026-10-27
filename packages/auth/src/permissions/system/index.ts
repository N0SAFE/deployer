// Export core builder
export { PermissionBuilder, RoleBuilder } from '@deployer/auth/permissions/system/builder/builder';

// Export base configuration class
export { BaseConfig } from '@deployer/auth/permissions/system/builder/shared/base-config';

// Export statement configuration classes
export { StatementConfig } from '@deployer/auth/permissions/system/builder/statements/single-statement-config';
export { StatementsConfig } from '@deployer/auth/permissions/system/builder/statements/statements-config';
export { StatementConfigCollection } from '@deployer/auth/permissions/system/builder/statements/statement-config-collection';

// Export role configuration classes
export { RoleConfig } from '@deployer/auth/permissions/system/builder/roles/single-role-config';
export { RolesConfig } from '@deployer/auth/permissions/system/builder/roles/roles-config';
export { RoleConfigCollection } from '@deployer/auth/permissions/system/builder/roles/role-config-collection';

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
  AccessControlInstance,
} from '@deployer/auth/permissions/system/types';
