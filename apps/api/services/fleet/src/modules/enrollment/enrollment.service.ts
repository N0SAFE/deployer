import { ORPCError, type ClientContext, type ClientLink } from "@orpc/client";
import type {
  MeshEnrollmentDescribeResult,
  MeshEnrollmentEnrollInput,
  MeshEnrollmentEnrollResult,
  MeshNetworkCluster,
  MeshSwarmJoinGrant,
} from "@deployer/contracts-entities";

const CALL = { context: {} } as const;

/** What enrolling a node touches, as plain functions so the rules can be tested without the platform. */
export type EnrollmentPorts = {
  readonly version: string;
  /** The WireGuard mesh a joiner's entry must name, or null when this node has none. */
  readonly cluster: () => Promise<MeshNetworkCluster | null>;
  /** The fleet's swarm role decision for a joiner, or null when it has no swarm to hand over. */
  readonly swarmGrant: (policy: MeshEnrollmentEnrollInput["requestedSwarmPolicy"]) => Promise<MeshSwarmJoinGrant | null>;
  /** Admits a joiner's signed WireGuard entry; null when it cannot be admitted. */
  readonly admit: (request: unknown) => Promise<{ roster: unknown } | null>;
  /** The shared database URL a joiner points at, or null when this node was never set up. */
  readonly databaseUrl: () => string | null;
  /** Records the joiner in the fleet's registry. */
  readonly register: (input: { nodeId: string; serverUrl: string; displayName: string | null }) => Promise<{ nodeId: string; enrolledAt: string }>;
};

/**
 * Takes a node that holds a join token into the fleet.
 *
 * The token is the authorization: only the agent holds the swarm's credential, so the fleet asks its own agent whether
 * the token is the swarm's and still good. A node with no agent cannot vouch for anyone, so it enrolls no one.
 */
export class EnrollmentService {
  constructor(
    private readonly agent: () => ClientLink<ClientContext> | undefined,
    private readonly ports: EnrollmentPorts,
  ) {}

  async describe(token: string): Promise<MeshEnrollmentDescribeResult> {
    await this.authorize(token);
    return { version: this.ports.version, meshNetwork: await this.ports.cluster() };
  }

  async enroll(input: MeshEnrollmentEnrollInput): Promise<MeshEnrollmentEnrollResult> {
    await this.authorize(input.token);

    const databaseUrl = this.ports.databaseUrl();
    if (databaseUrl === null || databaseUrl.length === 0) {
      throw new ORPCError("PRECONDITION_FAILED", { message: "This node has no database URL to hand over: run its setup first" });
    }

    const registered = await this.ports.register({ nodeId: input.nodeId, serverUrl: input.serverUrl, displayName: input.displayName ?? null });
    // The fleet, not the joiner, decides the swarm role; a joiner can neither promote itself nor found a rival swarm.
    const swarmGrant = await this.ports.swarmGrant(input.requestedSwarmPolicy);
    const meshAdmission = input.meshJoinRequest === undefined ? null : await this.ports.admit(input.meshJoinRequest);

    return { nodeId: registered.nodeId, enrolledAt: registered.enrolledAt, databaseUrl, swarmGrant, meshAdmission: meshAdmission as MeshEnrollmentEnrollResult["meshAdmission"] };
  }

  private async authorize(token: string): Promise<void> {
    const link = this.agent();
    if (link === undefined) {
      throw new ORPCError("UNAUTHORIZED", { message: "This node has no mesh agent, so it cannot vouch for a join token" });
    }
    const { valid } = (await link.call(["roster", "check"], { token }, CALL)) as { valid: boolean };
    if (!valid) {
      throw new ORPCError("UNAUTHORIZED", { message: "The join token is not valid" });
    }
  }
}
