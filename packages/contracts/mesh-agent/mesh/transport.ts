/**
 * Where a mesh peer's persistent websocket answers, on the same port as the service's HTTP. Services and agents serve it,
 * and the pooled links open it with the mesh credential in the `credential` query parameter (a websocket cannot carry a
 * header).
 */
export const MESH_WEBSOCKET_PATH = "/mesh/ws";

/**
 * The file name of the unix socket an agent listens on for the services of its own node, in its data directory's `run`
 * folder. The socket's permissions are the trust boundary there: a service on the node reaches its agent through it
 * without ever holding the swarm's credential.
 */
export const MESH_LOCAL_SOCKET_NAME = "agent.sock";
