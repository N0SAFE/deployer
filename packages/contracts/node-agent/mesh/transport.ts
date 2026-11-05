/**
 * Where a mesh peer's persistent websocket answers, on the same port as the service's HTTP. Services and agents serve it,
 * and the pooled links open it with the mesh credential in the `credential` query parameter (a websocket cannot carry a
 * header).
 */
export const MESH_WEBSOCKET_PATH = '/mesh/ws'

/**
 * The file name of the unix socket an agent listens on for the services of its own node, in its data directory's `run`
 * folder. The socket's permissions are the trust boundary there: a service on the node reaches its agent through it
 * without ever holding the swarm's credential.
 */
export const MESH_LOCAL_SOCKET_NAME = 'agent.sock'

/**
 * The file name of the ADMIN socket: the same agent, same node, but the procedures a service may not use (rotate the
 * swarm credential, issue or redeem a join token, configure the node, cut a member off). It is mode 0600 and lives in
 * its own directory, so a deployment can mount it into the few processes that perform operator actions instead of
 * every service on the node.
 */
export const MESH_ADMIN_SOCKET_NAME = 'admin.sock'
