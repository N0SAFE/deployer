# Q&A — Edge & Mesh: Integrations

> **Module**: edge-mesh  
> **Category**: integrations  
> **Last updated**: 2026-10-07

---

## Private-mesh technology

**Q**: Which private-mesh technology should the platform drive for node↔node traffic and operator access (outbound-only, NAT traversal, relay fallback — no inbound port on any node)? Options offered: Tailscale client (Headscale or SaaS), NetBird client, both behind one interface, or native platform-managed WireGuard.

**A**: "Find a solution where there is not one source of truth, so everything is mesh first instead of one source of truth and the others connect to it."

→ Interpretation recorded: no control server, coordinator or lighthouse that the other nodes depend on. Headscale, NetBird management and Tailscale SaaS are all central control planes and are therefore rejected.

---

## Mesh design (follow-up)

**Q**: For the mesh-first network, which design should be built — a peer-equal mesh built into the deployer (self-generated identity, key-derived address, signed roster replicated by gossip, any member can admit or relay; links: LAN/direct UDP → relay through another member's outbound session), or Nebula with every node as lighthouse + relay (needs at least one node with inbound UDP)?

**A**: Peer-equal mesh, built in.

---

## Traefik placement and route distribution

**Q**: Where should Traefik run, and how should it get its routes — every node with routes pulled from the API over the overlay (HTTP provider, no docker socket), or managers only with the socket and a file volume?

**A**: Every node, routes pulled from the API (no docker socket).
