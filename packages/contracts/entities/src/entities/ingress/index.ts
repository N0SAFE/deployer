/**
 * Ingress — how clients reach the stack (lanes), which pluggable edge carries the
 * public lane (edge providers), and how a stranger joins (entry points). One
 * definition shared by the API, the web app and the supervisors. See
 * `docs/edge-mesh-architecture.md`.
 */

export {
	ingressLaneSchema,
	INGRESS_LANES,
	routeVisibilitySchema,
	publicLaneSchema,
	ingressLanesSchema,
	DEFAULT_PRIVATE_DOMAIN,
	DEFAULT_ENTRY_PORT,
	defaultIngressLanes,
	enabledLanes,
	lanesForVisibility,
	ingressExposure,
} from './lanes.schema'

export type {
	IngressLane,
	RouteVisibility,
	PublicLane,
	IngressLanes,
	IngressExposure,
} from './lanes.schema'

export {
	edgeProviderKindSchema,
	edgeProviderIdSchema,
	edgeOptionValueSchema,
	edgeOptionsSchema,
	edgeOptionFieldSchema,
	edgeProviderDescriptorSchema,
	edgeFactSchema,
	edgeResourceSchema,
	edgeHealthSchema,
	edgeStatusSchema,
} from './edge-providers.schema'

export type {
	EdgeProviderKind,
	EdgeOptionValue,
	EdgeOptions,
	EdgeOptionField,
	EdgeProviderDescriptor,
	EdgeFact,
	EdgeResource,
	EdgeHealth,
	EdgeStatus,
} from './edge-providers.schema'

export {
	joinEntryPointKindSchema,
	INGRESS_JOIN_ENTRY_POINTS,
	joinEntryPointSchema,
	joinEntryPointSummarySchema,
	publicEntryHost,
	joinEntryPoints,
} from './entry-points.schema'

export type {
	JoinEntryPointKind,
	JoinEntryPoint,
	JoinEntryPointSummary,
	JoinEntryPointInputs,
	PublicJoinPath,
} from './entry-points.schema'
