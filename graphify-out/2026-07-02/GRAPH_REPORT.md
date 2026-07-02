# Graph Report - v3  (2026-07-02)

## Corpus Check
- 2495 files · ~2,078,993 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 143 nodes · 293 edges · 13 communities (11 shown, 2 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `372f2593`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_docker.repository.ts|docker.repository.ts]]
- [[_COMMUNITY_DockerRepository|DockerRepository]]
- [[_COMMUNITY_StartupOrchestratorService|StartupOrchestratorService]]
- [[_COMMUNITY_cluster-migration-state.ts|cluster-migration-state.ts]]

## God Nodes (most connected - your core abstractions)
1. `DockerRepository` - 104 edges
2. `StartupOrchestratorService` - 11 edges
3. `DOCKER_NETWORK_DRIVERS` - 2 edges
4. `DOCKER_NETWORK_SCOPES` - 2 edges
5. `clusterMigrationState` - 1 edges
6. `__filename` - 1 edges
7. `__dirname` - 1 edges
8. `APP_VERSION` - 1 edges
9. `ParsedFilterEntry` - 1 edges
10. `ContractFilterKeys` - 1 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (13 total, 2 thin omitted)

### Community 0 - "docker.repository.ts"
Cohesion: 0.08
Nodes (21): BuildScanEventInput, ContainerLinkedDeploymentRecord, ContainerLinkedProjectRecord, ContainerLinkedServiceRecord, ContractFilterKeys, DOCKER_NETWORK_DRIVERS, DOCKER_NETWORK_SCOPES, DockerImageLifecycleRecord (+13 more)

### Community 3 - "StartupOrchestratorService"
Cohesion: 0.18
Nodes (4): APP_VERSION, __dirname, __filename, StartupOrchestratorService

## Knowledge Gaps
- **23 isolated node(s):** `clusterMigrationState`, `__filename`, `__dirname`, `APP_VERSION`, `ParsedFilterEntry` (+18 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DockerRepository` connect `DockerRepository` to `docker.repository.ts`, `.inspectImage`, `.isMissingDockerSecurityScanTableError`, `.formatError`, `.listImages`, `.normalizeScannerVulnerability`, `.persistRuntimeActivityEvent`, `.attachContainerLinks`, `.inspectContainer`, `.serviceLinkFromRecord`?**
  _High betweenness centrality (0.717) - this node is a cross-community bridge._
- **What connects `clusterMigrationState`, `__filename`, `__dirname` to the rest of the system?**
  _23 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `docker.repository.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08333333333333333 - nodes in this community are weakly interconnected._