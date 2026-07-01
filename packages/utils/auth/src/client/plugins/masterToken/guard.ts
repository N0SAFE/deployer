import type { MasterTokenManager as _MasterTokenManager } from './state'
import { isRecord, isObjectLike } from "@repo/type-guards"

// The runtime plugin exposes these actions on the auth client.
export interface MasterTokenActions {
  // $masterTokenSignOut is a factory function that wraps the original signOut
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $masterTokenSignOut: <TSignOut extends (...args: any[]) => Promise<any>>(signOutFn: TSignOut) => (...args: Parameters<TSignOut>) => Promise<Awaited<ReturnType<TSignOut>> | null>
  getMasterTokenEnabled: typeof import('./state').getMasterTokenEnabled
  setMasterTokenEnabled: typeof import('./state').setMasterTokenEnabled
  clearMasterToken: typeof import('./state').clearMasterToken
  getMasterTokenKey: typeof import('./state').getMasterTokenKey
  MasterTokenManager: typeof _MasterTokenManager
}

/**
 * Runtime type-guard that narrows an `AuthClient` to include the master-token
 * plugin actions when they are present on the object.
 */

/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys. Used in place of `as Record<string, unknown>`
 * to avoid the runtime lie.
 */
export function hasMasterTokenPlugin<TClient>(
  client: TClient
): client is TClient & MasterTokenActions {
  const candidate = client as Record<string, unknown>
  // check for a small set of keys that the plugin adds
  return (
    '$masterTokenSignOut' in candidate || typeof candidate.$masterTokenSignOut !== 'undefined' ||
    'getMasterTokenEnabled' in candidate || typeof candidate.getMasterTokenEnabled !== 'undefined' ||
    'setMasterTokenEnabled' in candidate || typeof candidate.setMasterTokenEnabled !== 'undefined' ||
    'clearMasterToken' in candidate || typeof candidate.clearMasterToken !== 'undefined' ||
    'getMasterTokenKey' in candidate || typeof candidate.getMasterTokenKey !== 'undefined' ||
    'MasterTokenManager' in candidate || typeof candidate.MasterTokenManager !== 'undefined'
  )
}

export default hasMasterTokenPlugin
