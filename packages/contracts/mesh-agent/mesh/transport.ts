/**
 * Where a mesh peer's persistent websocket answers, on the same port as the service's HTTP. Services and agents serve it,
 * and the pooled links open it with the mesh credential in the `credential` query parameter (a websocket cannot carry a
 * header).
 */
export const MESH_WEBSOCKET_PATH = "/mesh/ws";
