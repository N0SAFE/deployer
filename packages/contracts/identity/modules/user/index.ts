import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";


// Import all contract definitions
import { userCheckEmailContract } from './checkEmail';
import { userCountContract } from './count';
import { userCreateContract } from './create';
import { userDeleteContract } from './delete';
import { userFindByIdContract } from './findById';
import { userListContract } from './list';
import { userUpdateContract } from './update';
import { userRevokeSessionsContract, userSetBannedContract, userSetRoleContract } from './admin';

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
