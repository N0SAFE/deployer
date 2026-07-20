# Docker — Contracts Layer (Subagent 3/3)

## Contract Files: ~8 files in packages/contracts/api/modules/docker/
Types: containers, images, networks, volumes, registries, stacks, runtime, entity

## Total Operations: ~30+
- Containers: list, listGrouped, inspect, logsStream, processes, processesStream, processLogsStream, linkedList, files, readFile, writeFile, createDirectory, renamePath, deletePath, runtimeAction, inspectStream, terminalOpen, terminalInput, terminalClose, terminalStream
- Images: list, inspect, securityScanStream, inspectStream
- Networks: list
- Volumes: list
- Registries: list
- Stacks: list
- Runtime: eventsStream, snapshot, activityList, activityDetail, activityStream
- Entity: list, inspect, stream

## Entity Schemas: 8 docker entity types
- Container (base, inspect, logs, processes, relations, runtime-events, snapshots, terminal)
- Image (base, details, relations, runtime-events)
- Network (base, details, relations, runtime-events)
- Volume (base, details, relations, runtime-events)
- Registry (base, details, relations)
- Stack (base, details, relations)
- Security (scan — partial)
- Projects (empty directory)

## Dockerode Schemas: 4 entity types
- Container (list + inspect)
- Image (summary + inspect)
- Network (summary)
- Volume (entry)

## Stream/SSE Schema
- `dockerEntityStreamChunkSchema` — defined with discriminated union for entity kinds
- Server-side validation required per emission (ORPC doesn't auto-validate)
- Discriminated union: `kind: "container" | "image" | "network" | "volume"`

## Gaps
- Security directory: partial (scan schema exists, projects empty)
- Projects directory: empty
- Some dockerode schemas may be missing for registries, stacks

## Action Items
1. [M] Ensure all stream chunks validated server-side — `entity.ts`, `runtime.ts` producers
2. [S] Fill security schema gaps or remove empty directories
3. [S] Fill projects schema or remove empty directory
4. [M] Add dockerode schemas for registries and stacks if needed
