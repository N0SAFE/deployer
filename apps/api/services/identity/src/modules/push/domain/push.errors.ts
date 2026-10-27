import { NotFoundError } from "@deployer/errors";

/**
 * Thrown for an unknown endpoint AND for one owned by somebody else: the two are
 * deliberately indistinguishable, because telling them apart would confirm that
 * an endpoint belongs to another account.
 */
export function pushSubscriptionNotFound(endpoint: string): NotFoundError {
	return new NotFoundError("push subscription", endpoint);
}
