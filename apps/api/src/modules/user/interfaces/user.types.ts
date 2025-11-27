/**
 * User Type Definitions
 * 
 * This file contains all type definitions for the user module,
 * extracted from @repo/api-contracts to ensure type safety.
 */

import {
  userFindByIdOutput,
  userListOutput,
  userCreateOutput,
  userUpdateOutput,
  userDeleteOutput,
  userCheckEmailOutput,
  userCountOutput,
} from '@repo/api-contracts';
import { z } from 'zod/v4';

// ✅ Extract exact output types from contracts using z.infer pattern
export type UserContract = z.infer<typeof userFindByIdOutput>;
export type UserListContract = z.infer<typeof userListOutput>;
export type UserCreateContract = z.infer<typeof userCreateOutput>;
export type UserUpdateContract = z.infer<typeof userUpdateOutput>;
export type UserDeleteContract = z.infer<typeof userDeleteOutput>;
export type UserCheckEmailContract = z.infer<typeof userCheckEmailOutput>;
export type UserCountContract = z.infer<typeof userCountOutput>;

// Input types (already exported from repository, but centralized here for clarity)
export type { CreateUserInput, UpdateUserInput, GetUsersInput } from '../repositories/user.repository';
