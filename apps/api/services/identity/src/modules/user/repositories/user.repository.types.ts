import type { User } from "../domain/user.types";

/** One filter condition as the generated query builder emits it. */
export type OperatorFilter = {
  readonly operator: string;
  readonly value: unknown;
};


/** A page of users plus the total, so a client can render pagination. */
export type UserPage = {
  readonly data: User[];
  readonly total: number;
};


export type UserSortField = "createdAt" | "name" | "email" | "updatedAt";

/** The filters `list` and `count` accept, as the contract's list config declares them. */
export type UserListFilter = {
  readonly limit: number;
  readonly offset: number;
  readonly sortField: UserSortField;
  readonly sortDirection: "asc" | "desc";
  readonly id?: OperatorFilter;
  readonly email?: OperatorFilter;
  readonly name?: OperatorFilter;
  readonly emailVerified?: unknown;
  readonly createdAt?: OperatorFilter;
};

/** The parts of a filter that decide WHICH rows, as opposed to how they are paged. */
export type UserFilter = Omit<UserListFilter, "limit" | "offset" | "sortField" | "sortDirection">;
