import { ConflictError, NotFoundError } from "@deployer/errors";

/** Thrown as a typed 404 rather than a null return, so a client gets a code. */
export function userNotFound(id: string): NotFoundError {
  return new NotFoundError("user", id);
}

/** Thrown when a create/update would collide with an existing account. */
export function emailAlreadyTaken(email: string): ConflictError {
  return new ConflictError(`an account for "${email}" already exists`);
}
