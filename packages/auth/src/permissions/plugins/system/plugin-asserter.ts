/**
 * AssertionDefinition - The return type for ANY plugin method that checks permissions
 *
 * Each plugin defines whatever methods IT wants. As long as they return this type,
 * the converters can turn them into decorators or middlewares.
 */

import type { AssertionDefinition, CompositePayload } from '@deployer/auth/permissions/plugins/system/assertion'
import { createAssertion, assertAll, assertAny, assertNot } from '@deployer/auth/permissions/plugins/system/assertion'

// Re-export everything from assertion for convenience
export { 
  type AssertionDefinition, 
  type CompositePayload,
  createAssertion, 
  assertAll, 
  assertAny, 
  assertNot 
}
