import { Observable } from "rxjs";
import type { ClientContext, ClientLink } from "@orpc/client";
import type {
  MeshAgentJoinTokenInput,
  MeshAgentJoinTokenResult,
  MeshAgentLookupInput,
  MeshAgentLookupResult,
  MeshAgentNode,
  MeshAgentNodesResult,
  MeshAgentSnapshot,
} from "@deployer/contracts-entities";

const CALL = { context: {} } as const;

type AgentView = { self: { nodeId: string; address: string }; agents: { nodeId: string; address: string }[] };
type AgentReplica = { service: string; replicaId: string; nodeId: string; load: number; keys: string[] };

/** What the dashboard asks of a node without an agent: it is a swarm of one, whose node is known by its own id only. */
export type StandaloneNode = () => Promise<{ nodeId: string }>;

/**
 * The dashboard's picture of the mesh, read from the agent of this node.
 *
 * Nothing is measured here: the nodes and replicas are what the agents report, and a join token is issued by the agent,
 * which alone holds the swarm's credential. A node without an agent is a swarm of one.
 */
export class MeshViewService {
  constructor(
    private readonly agent: () => ClientLink<ClientContext> | undefined,
    private readonly standalone: StandaloneNode,
    /** How often the topology stream looks again. */
    private readonly pollMs = 3_000,
  ) {}

  async localNode(): Promise<MeshAgentNode> {
    const link = this.agent();
    if (link === undefined) {
      return { nodeId: (await this.standalone()).nodeId, address: "", local: true };
    }
    const { self } = (await link.call(["roster", "view"], {}, CALL)) as AgentView;
    return { ...self, local: true };
  }

  async peers(): Promise<MeshAgentNodesResult> {
    const link = this.agent();
    if (link === undefined) {
      return { items: [await this.localNode()] };
    }
    return { items: await this.nodes(link) };
  }

  async snapshot(): Promise<MeshAgentSnapshot> {
    const link = this.agent();
    if (link === undefined) {
      return { generatedAt: new Date().toISOString(), nodes: [await this.localNode()], replicas: [] };
    }
    const nodes = await this.nodes(link);
    const { replicas } = (await link.call(["directory", "snapshot"], {}, CALL)) as { replicas: AgentReplica[] };
    return {
      generatedAt: new Date().toISOString(),
      nodes,
      replicas: replicas.map(({ service, replicaId, nodeId, load, keys }) => ({ service, replicaId, nodeId, load, keys })),
    };
  }

  /** The swarm now, and again each time it differs from what was last sent. */
  topology(): Observable<MeshAgentSnapshot> {
    return new Observable<MeshAgentSnapshot>((subscriber) => {
      let last = "";
      let closed = false;
      const look = async () => {
        try {
          const current = await this.snapshot();
          const fingerprint = JSON.stringify({ nodes: current.nodes, replicas: current.replicas });
          if (!closed && fingerprint !== last) {
            last = fingerprint;
            subscriber.next(current);
          }
        } catch {
          // The agent is not reachable right now: say nothing, and look again.
        }
      };
      void look();
      const timer = setInterval(() => void look(), this.pollMs);
      return () => {
        closed = true;
        clearInterval(timer);
      };
    });
  }

  async lookup(input: MeshAgentLookupInput): Promise<MeshAgentLookupResult> {
    const link = this.agent();
    if (link === undefined) {
      return { found: false, replica: null, reason: null };
    }
    try {
      const { replica, reason } = (await link.call(["directory", "resolve"], input, CALL)) as {
        replica: AgentReplica;
        reason: NonNullable<MeshAgentLookupResult["reason"]>;
      };
      const { service, replicaId, nodeId, load, keys } = replica;
      return { found: true, replica: { service, replicaId, nodeId, load, keys }, reason };
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "NOT_FOUND") {
        return { found: false, replica: null, reason: null };
      }
      throw error;
    }
  }

  /** A token for a new node. A node with no agent cannot issue one: there is no swarm credential to hand over. */
  async issueToken(input: MeshAgentJoinTokenInput): Promise<MeshAgentJoinTokenResult> {
    const link = this.agent();
    if (link === undefined) {
      throw new Error("This node has no mesh agent, so it cannot issue a join token");
    }
    return (await link.call(["roster", "token"], input, CALL)) as MeshAgentJoinTokenResult;
  }

  private async nodes(link: ClientLink<ClientContext>): Promise<MeshAgentNode[]> {
    const { self, agents } = (await link.call(["roster", "view"], {}, CALL)) as AgentView;
    return [{ ...self, local: true }, ...agents.map((agent) => ({ ...agent, local: false }))];
  }
}
