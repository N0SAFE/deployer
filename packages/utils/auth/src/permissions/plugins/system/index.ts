/**
 * System-level plugin exports for permissions/plugins
 */

export {
  PluginWrapperRegistry,
  type PluginWrapper,
  type PluginWrapperFactory,
} from '@repo/auth/permissions/plugins/system/registry';

export {
  type WithAuthPlugins,
  type MinimalAuth,
} from '@repo/auth/permissions/plugins/system/auth-with-plugins';

export {
  BasePluginWrapper,
  type BasePluginWrapperOptions,
  type AnyPluginWrapper,
  type InferParams,
  type ExtractBody,
  type ExtractQuery,
  type InferSessionFromAuth,
  // Error classes for assertion failures
  PermissionAssertionError,
  RoleAssertionError,
} from '@repo/auth/permissions/plugins/system/base-plugin-wrapper';

export {
  type AnyPermissionBuilder,
  type InferStatementFromBuilder,
  type InferRolesFromBuilder,
  type InferRoleNamesFromBuilder,
} from '@repo/auth/permissions/plugins/system/type-inference';

// Assertion system - for creating plugin methods that return assertion definitions
export {
  type AssertionDefinition,
  type AssertionMetadata,
  type CompositePayload,
  type CompositeOperator,
  type InferPayload,
  createAssertion,
  createAssertionMetadata,
  assertAll,
  assertAny,
  assertNot,
  isAssertionDefinition,
  isAssertionMetadata,
  isCompositeAssertion,
} from '@repo/auth/permissions/plugins/system/assertion';
