import { Schema } from 'effect'

/** What a peer reports about itself at its identity endpoint. */
export class PeerIdentity extends Schema.Class<PeerIdentity>(
    'reachability/PeerIdentity'
)({
    advertisedHost: Schema.optional(Schema.String),
    version: Schema.optional(Schema.String),
}) {}
