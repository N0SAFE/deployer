import type { Route } from './svg-kit';

export type NodeId = 'A' | 'B' | 'C';

/** How much of a story is in the code today. */
export type StoryStatus = 'built' | 'mechanism' | 'design';

/** One line on the diagram: an SVG path, the router it travels on, and how to draw it. */
export type StoryPath = readonly [d: string, route: Route, style?: 'dashed' | 'wide'];

export type StoryStep = {
  readonly title: string;
  readonly detail: string;
  /** The agents the step is about. */
  readonly highlight: readonly NodeId[];
  readonly paths: readonly StoryPath[];
};

export type Story = {
  readonly name: string;
  readonly status: StoryStatus;
  /** What is built and what is not, for this story. */
  readonly note: string;
  readonly steps: readonly StoryStep[];
};

export const STATUS_LABEL: Record<StoryStatus, string> = {
  built: 'Built',
  mechanism: 'Mechanism built',
  design: 'Design',
};

export const STORIES: readonly Story[] = [
  {
    name: 'User: container logs',
    status: 'built',
    note: 'The runtime serves the logs on its node router; a call pinned to a node is forwarded to that node\'s agent.',
    steps: [
      { title: 'bff 1 calls its local agent', detail: 'The call leaves bff 1 on its one persistent link to agent A. It names a node, not a replica: a node-pinned call.', highlight: ['A'], paths: [['M108 87H96', 'node']] },
      { title: 'Agent A routes to agent B', detail: 'Agent A finds node B in its roster and uses its pooled link to agent B (direct, or through a bridge in a large mesh).', highlight: ['A', 'B'], paths: [['M66 72V50H281V70', 'node']] },
      { title: 'Agent B calls runtime 2', detail: 'Agent B calls runtime 2 on its own node, which reads that node\'s Docker socket.', highlight: ['B'], paths: [['M309 239H321', 'node']] },
      { title: 'Logs stream back', detail: 'Log entries flow back over the same links, runtime 2 to agent B to agent A to bff 1, with no new connection.', highlight: ['A', 'B'], paths: [['M321 245H309', 'node'], ['M296 72V56H80V70', 'node'], ['M96 96H106', 'node']] },
    ],
  },
  {
    name: 'User: list projects',
    status: 'built',
    note: 'Resolution prefers a replica on the agent\'s own node, so a service replicated on every node is always served locally.',
    steps: [
      { title: 'bff 2 asks its agent for project', detail: 'bff 2 names the service project only: no key and no replica. Project runs on all three nodes.', highlight: ['B'], paths: [['M323 87H311', 'external']] },
      { title: 'Agent B picks the replica on its own node', detail: 'Locality first: the directory shows project 2 on node B, so agent B serves the call there and nothing crosses to node A or C.', highlight: ['B'], paths: [['M309 156H321', 'external']] },
      { title: 'project 2 answers', detail: 'The answer returns through agent B to bff 2. No other node was involved.', highlight: ['B'], paths: [['M321 170H309', 'external'], ['M311 96H321', 'external']] },
    ],
  },
  {
    name: 'User: log in',
    status: 'built',
    note: 'With no replica on the node, the agent picks the least loaded replica of the whole fleet from the gossiped directory.',
    steps: [
      { title: 'bff 2 asks its agent for identity', detail: 'bff 2 names the service identity only: no key and no replica.', highlight: ['B'], paths: [['M323 87H311', 'external']] },
      { title: 'Agent B resolves in the directory', detail: 'Node B has no identity replica, so locality cannot help. The gossiped directory offers identity 1 on A and identity 2 on C; agent B picks identity 2, the least loaded, and sends the call to agent C.', highlight: ['B', 'C'], paths: [['M281 72V50H496V70', 'external']] },
      { title: 'Agent C calls identity 2', detail: 'Agent C delivers the call to its local replica.', highlight: ['C'], paths: [['M524 125H536', 'external']] },
      { title: 'The answer returns the same way', detail: 'The answer goes back through both agents. bff 2 never learns where identity ran.', highlight: ['B', 'C'], paths: [['M536 131H524', 'external'], ['M481 72V56H296V70', 'external'], ['M311 96H321', 'external']] },
    ],
  },
  {
    name: 'Developer: terminal',
    status: 'built',
    note: 'The terminal procedures are on the runtime\'s node router and the call is pinned to the node. Terminal sessions are not announced as keys yet.',
    steps: [
      { title: 'bff 2 asks for a terminal on node C', detail: 'bff 2 asks its local agent to open a terminal session on node C.', highlight: ['B'], paths: [['M323 87H311', 'node']] },
      { title: 'Agent B relays to agent C', detail: 'Agent B uses its pooled link to agent C.', highlight: ['B', 'C'], paths: [['M281 72V50H496V70', 'node']] },
      { title: 'Agent C opens the session', detail: 'Agent C asks runtime 3 to open an exec session in the container.', highlight: ['C'], paths: [['M524 239H536', 'node']] },
      { title: 'Output streams back', detail: 'Terminal output flows back as a stream over the same pooled links.', highlight: ['B', 'C'], paths: [['M536 245H524', 'node'], ['M481 72V56H296V70', 'node'], ['M311 96H321', 'node']] },
      { title: 'Keystrokes flow the other way', detail: 'Keystrokes reuse the links that are already open. Nothing reconnects for each key.', highlight: ['B', 'C'], paths: [['M323 78H311', 'node'], ['M524 233H536', 'node']] },
    ],
  },
  {
    name: 'Developer: deploy',
    status: 'mechanism',
    note: 'The agent answers redirects and caches the key hint today. No service answers MESH_REDIRECT yet: project resolves by locality and load.',
    steps: [
      { title: 'bff 1 calls project', detail: 'bff 1 asks agent A for the service project. It does not know which replica holds the deployment.', highlight: ['A'], paths: [['M108 87H96', 'external']] },
      { title: 'Agent A picks the local replica', detail: 'The directory holds no key for this deployment, so locality wins: agent A calls project 1 on its own node.', highlight: ['A'], paths: [['M94 156H106', 'external']] },
      { title: 'project 1 answers MESH_REDIRECT to the agent', detail: 'project 1 does not hold the deployment. It fails with MESH_REDIRECT { replica: project 3 }. The agent receives it, not bff 1 (dashed).', highlight: ['A'], paths: [['M108 170H96', 'external', 'dashed']] },
      { title: 'Agent A replays the call on project 3', detail: 'Agent A resolves project 3 and replays the call through agent C, up to 3 hops. It remembers the key-to-replica hint for 5 seconds.', highlight: ['A', 'C'], paths: [['M66 72V50H496V70', 'external']] },
      { title: 'Agent C calls project 3', detail: 'Agent C delivers the call to project 3, which holds the deployment.', highlight: ['C'], paths: [['M524 163H536', 'external']] },
      { title: 'The result returns', detail: 'The result flows back through agent C and agent A to bff 1. bff 1 never saw the redirect.', highlight: ['A', 'C'], paths: [['M536 169H524', 'external'], ['M481 72V56H80V70', 'external'], ['M96 101H106', 'external']] },
    ],
  },
  {
    name: 'Developer: live deploy log',
    status: 'mechanism',
    note: 'Leases, grants and the direct links that follow them are built and tested. Deployment streams are served from the node that runs the deployment today, not through a lease.',
    steps: [
      { title: 'bff 1 asks for the stream', detail: 'bff 1 asks agent A for the deploy-log stream of one deployment, key = the deployment id.', highlight: ['A'], paths: [['M108 87H96', 'external']] },
      { title: 'Agent A resolves the key', detail: 'The directory says runtime 2 holds this stream. It is a long, heavy stream on a single resource, so agent A decides not to relay it.', highlight: ['A'], paths: [] },
      { title: 'Agent A answers MESH_DIRECT', detail: 'A signed grant for runtime 2 that lives 30 seconds: replica, address, token and ttl (dashed amber). This is the one code the caller itself acts on.', highlight: ['A'], paths: [['M96 96H106', 'lease', 'dashed']] },
      { title: 'bff 1 opens a pooled direct link', detail: 'The caller\'s link opens, or reuses, a pooled websocket to runtime 2 over the overlay network and replays the call with the token.', highlight: [], paths: [['M188 87H196V304H411V239H405', 'lease', 'wide']] },
      { title: 'Events stream over the lease', detail: 'runtime 2 checks the token (with its own agent) and streams events straight to bff 1. Agent A carries none of the traffic.', highlight: [], paths: [['M405 245H415V312H205V93H190', 'lease', 'wide']] },
      { title: 'The lease ends', detail: 'When the lease expires, or runtime 2 dies and the directory drops it, the link returns to the pool and the next call asks agent A again.', highlight: ['A'], paths: [] },
    ],
  },
  {
    name: 'Admin: fleet usage',
    status: 'design',
    note: 'The runtime fans its lists and catalogs out to every node (this node included) today. Fleet-wide node usage through the agent is not wired.',
    steps: [
      { title: 'fleet 1 sends one call', detail: 'fleet 1 sends a single call to agent A with the target "all nodes".', highlight: ['A'], paths: [['M108 201H96', 'node']] },
      { title: 'Agent A fans out', detail: 'Agent A sends the call to agents B and C (through bridges in a large mesh).', highlight: ['A', 'B', 'C'], paths: [['M66 72V50H281V70', 'node'], ['M281 50H496V70', 'node']] },
      { title: 'Each agent reads its own node', detail: 'Every agent collects usage from its own node, host stats and the local runtime. Nothing crosses the network in this step.', highlight: ['A', 'B', 'C'], paths: [] },
      { title: 'Results merge back', detail: 'Agents B and C answer agent A, which merges everything into one response for fleet 1.', highlight: ['A', 'B', 'C'], paths: [['M296 72V56H80V70', 'node'], ['M511 72V56H300', 'node'], ['M96 207H106', 'node']] },
    ],
  },
  {
    name: 'Developer: find a resource',
    status: 'design',
    note: 'The peer router (replicas asking each other) is not built. The redirect it ends with is.',
    steps: [
      { title: 'bff 1 calls runtime', detail: 'bff 1 asks agent A for the service runtime, with no replica named.', highlight: ['A'], paths: [['M108 87H96', 'external']] },
      { title: 'Agent A picks the local replica', detail: 'Locality first again: agent A calls runtime 1 on its own node.', highlight: ['A'], paths: [['M94 233H106', 'external']] },
      { title: 'runtime 1 asks its peers', detail: 'runtime 1 does not hold the resource. Its peers.ask leaves through agent A and fans out to the other replicas.', highlight: ['A', 'B', 'C'], paths: [['M108 247H96', 'peer'], ['M66 72V50H281V70', 'peer'], ['M281 50H496V70', 'peer']] },
      { title: 'Agents deliver the question', detail: 'Agents B and C hand the question to runtime 2 and runtime 3 on the peer router.', highlight: ['B', 'C'], paths: [['M309 247H321', 'peer'], ['M524 247H536', 'peer']] },
      { title: 'runtime 2 answers: I hold it', detail: 'runtime 2 answers through its agent, and the answer reaches runtime 1 through agent A.', highlight: ['A', 'B'], paths: [['M321 253H309', 'peer'], ['M296 72V56H80V70', 'peer'], ['M96 253H106', 'peer']] },
      { title: 'runtime 1 answers MESH_REDIRECT to the agent', detail: 'runtime 1 fails with MESH_REDIRECT { replica: runtime 2 }, received by agent A (dashed). If the resource should not move, runtime 1 forwards it itself instead.', highlight: ['A'], paths: [['M108 226H96', 'external', 'dashed']] },
      { title: 'Agent A replays the call on runtime 2', detail: 'Agent A sends the original call to runtime 2 through agent B.', highlight: ['A', 'B'], paths: [['M66 72V50H281V70', 'external'], ['M309 233H321', 'external']] },
      { title: 'The result returns', detail: 'The result flows back through agent B and agent A to bff 1.', highlight: ['A', 'B'], paths: [['M321 240H309', 'external'], ['M296 72V56H80V70', 'external'], ['M96 99H106', 'external']] },
    ],
  },
];
