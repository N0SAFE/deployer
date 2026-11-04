import { domainError } from "@deployer/effect-core";

/**
 * `dependency_missing` is the kind the wizard renders as "still waiting": the platform API legitimately does not
 * exist yet while setup runs (it starts behind the gate), so "cannot reach it" is progress, not a fault.
 */

/** `SETUP_API_URL` is not configured, so there is no API to forward to. */
export class ApiNotConfigured extends domainError("ApiNotConfigured", "dependency_missing")() {
  override publicMessage() {
    return "SETUP_API_URL is not configured — the setup app cannot reach the full API";
  }
}

/** The forward did not reach the API (connection refused, DNS, deadline). */
export class ApiUnreachable extends domainError("ApiUnreachable", "dependency_missing")<{ readonly url: string }>() {
  override publicMessage() {
    return `The platform API is not reachable yet (${this.url})`;
  }
}

/** The API never answered its event stream within the budget. */
export class ApiStreamUnreachable extends domainError("ApiStreamUnreachable", "dependency_missing")() {
  override publicMessage() {
    return "the platform API's stream never became reachable";
  }
}
