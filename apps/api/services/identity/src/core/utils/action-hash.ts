/**
 * The canonical action hash, shared with every service that files or spends an approval (`SEC-072`).
 *
 * Re-exported rather than re-implemented: the requester and the guard must agree byte for byte.
 */
export { actionHash } from "@deployer/auth/server";
