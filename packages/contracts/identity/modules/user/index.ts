import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";


// Import all contract definitions
import {
  userRevokeSessionsContract,
  userSetBannedContract,
  userSessionRevokeContract,
  userSessionsListContract,
  userSetPasswordContract,
  userSetRoleContract,
} from './admin';
import { userCheckEmailContract } from './checkEmail';
import { userCountContract } from './count';
import { userCreateContract } from './create';
import { userDeleteContract } from './delete';
import { userFindByIdContract } from './findById';
import { userListContract } from './list';
import { selfExportContract } from './self';
import { selfDeleteContract } from './self-delete';
import { userUpdateContract } from './update';

// Combine into main user contract
export const userContract = oc.meta(openapi({ tags: ["User"], prefix: "/user" })).router({
  list: userListContract,
  findById: userFindByIdContract,
  create: userCreateContract,
  update: userUpdateContract,
  delete: userDeleteContract,
  checkEmail: userCheckEmailContract,
  count: userCountContract,
  setRole: userSetRoleContract,
  setBanned: userSetBannedContract,
  revokeSessions: userRevokeSessionsContract,
  setPassword: userSetPasswordContract,
  listSessions: userSessionsListContract,
  revokeSession: userSessionRevokeContract,
  exportSelf: selfExportContract,
  deleteSelf: selfDeleteContract,
});

export type UserContract = typeof userContract;

// Re-export everything from individual contracts
export * from './list';
export * from './findById';
export * from './create';
export * from './update';
export * from './delete';
export * from './checkEmail';
export * from './count';
export * from './admin';
export * from './self';
export * from './self-delete';
