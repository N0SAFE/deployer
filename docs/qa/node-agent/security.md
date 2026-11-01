# Q&A — node-agent: Security

> **Module**: node-agent  
> **Category**: security  
> **Last updated**: 2026-10-31

---

## F-06 — splitting the local door

**Q**: Which production-readiness item should this pass implement first?

**A**: F-06, the local door split. P0 without needing new crypto: services keep register/resolve/relay/view/settings-read, and credential/rotate/join/configure move to a privileged door.

**Q**: How should the privileged door be separated from the service door?

**A**: A second unix socket with mode 0600. The service socket stays 0660 with a capability-scoped router; the admin socket is owned by the deployment user and holds credential/rotate/join/configure/node.*. Filesystem permissions are the boundary, no tokens to distribute.

**Q**: Which identity model for F-01 (signed settings), later in the roadmap?

**A**: Ed25519 node key in the roster. Each node generates a keypair on first boot and publishes its public key through gossip; settings carry writer id + signature, verified at ingest against that key. Also enables mTLS (F-04) and sender attribution in gossip.
