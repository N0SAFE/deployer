// Export core builder
export { PermissionBuilder, RoleBuilder } from '@repo/auth/permissions/system/builder/builder';

// Export base configuration class
export { BaseConfig } from '@repo/auth/permissions/system/builder/shared/base-config';

// Export statement configuration classes
export { StatementConfig } from '@repo/auth/permissions/system/builder/statements/single-statement-config';
export { StatementsConfig } from '@repo/auth/permissions/system/builder/statements/statements-config';
export { StatementConfigCollection } from '@repo/auth/permissions/system/builder/statements/statement-config-collection';

// Export role configuration classes
export { RoleConfig } from '@repo/auth/permissions/system/builder/roles/single-role-config';
export { RolesConfig } from '@repo/auth/permissions/system/builder/roles/roles-config';
export { RoleConfigCollection } from '@repo/auth/permissions/system/builder/roles/role-config-collection';

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
} from '@repo/auth/permissions/system/types';
