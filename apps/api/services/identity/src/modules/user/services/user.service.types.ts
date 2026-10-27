import type { UserFilter, UserListFilter } from "../repositories/user.repository.types";

/** The filters `list` and `count` accept, as the contract declares them. */
export type UserQuery = Pick<
  UserListFilter,
  "limit" | "offset" | "sortField" | "sortDirection"
> & {
  readonly filter: UserFilter;
};
