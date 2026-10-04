import { Controller, Logger } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement, ORPCError } from "@orpc/server";
import { setupAppContract } from "@repo/api-contracts";
import type {
  SetupPostSetupDestination,
  SetupProbeDbResult,
  SetupProbeMeshResult,
  SetupRemoteAuthResult,
} from "@repo/contracts-entities";

import { SetupGateService } from "./setup-gate.service";
import { WizardStateService } from "./wizard-state.service";
import { WizardStreamService } from "./wizard-stream.service";
import { WizardUpstreamService } from "./wizard-upstream.service";
import { OrchestrationStreamService } from "@/modules/progress/services/orchestration-stream.service";

/**
 * The forwarded bodies, named by the entity schemas rather than re-declared.
 *
 * The API answers these procedures with exactly these shapes, so typing the
 * forward by the contract's own entity types keeps the two ends from drifting:
 * a field the API adds is visible here, and one it removes is a compile error.
 */
type ProbeDbBody = SetupProbeDbResult;
type ProbeMeshBody = SetupProbeMeshResult;
type RemoteAuthBody = SetupRemoteAuthResult;

/**
 * The setup app's wizard surface, as an oRPC contract router.
 *
 * ── WHY oRPC AND NOT A WILDCARD PROXY ───────────────────────────────────────
 * The previous version forwarded `setup/*path` by string matching. Three
 * problems, all of which this removes:
 *
 *   1. UNTYPED — a path the contract gained would silently 404. Every procedure
 *      here is a named method, so a missing implementation is a compile error.
 *   2. THE GATE WAS HIDDEN — opening it was a side effect inside a string
 *      comparison. It is now the body of `triggerInitialize`, where it is
 *      visible and testable.
 *   3. IT BROKE ON EXPRESS 5 — a wildcard param is an ARRAY there, so
 *      `API_PATHS.includes(["trigger"])` was always false and EVERY proxied call
 *      returned "Unknown setup path". That is the bug this replaces.
 *
 * ── WHY THE CONTRACT IS THE APP'S OWN (`setupAppContract`) ──────────────────
 * It describes what THIS process serves, which is not the same set as the API's
 * `/setup`: `getState` is answered from the shared `node_config` row (the API
 * does not exist yet), and the stream reports work the API cannot report on
 * because it is the thing being started. See the contract's own note.
 *
 * ── WHY THE STREAM IS SUBSCRIBED, NOT PIPED AS BYTES ────────────────────────
 * The stream carries BOTH producers' events: setup's orchestration steps
 * (`initialize_swarm`, `start_api`, `await_api_boot`) and then the API's
 * provisioning events, forwarded verbatim. A byte-pipe could only carry the
 * second, and the wizard needs one continuous timeline.
 */
@Controller()
export class WizardController {
  private readonly logger = new Logger(WizardController.name);

  constructor(
    private readonly upstream: WizardUpstreamService,
    private readonly stream: WizardStreamService,
    private readonly gate: SetupGateService,
    private readonly state: WizardStateService,
    private readonly orchestration: OrchestrationStreamService,
  ) {}

  // ─── State (answered LOCALLY — the API does not exist yet) ──────────────

  @Implement(setupAppContract.getState)
  getState() {
    return implement(setupAppContract.getState).handler(() => this.state.getState());
  }

  @Implement(setupAppContract.getNodeStatus)
  getNodeStatus() {
    return implement(setupAppContract.getNodeStatus).handler(() => this.state.getNodeStatus());
  }

  // ─── Probes (forwarded — they need the API) ─────────────────────────────

  @Implement(setupAppContract.probeDatabase)
  probeDatabase() {
    return implement(setupAppContract.probeDatabase).handler(async ({ input }) => ({
      status: 201 as const,
      headers: {},
      body: await this.forwardJson<ProbeDbBody>("/setup/probe/database", "POST", input),
    }));
  }

  @Implement(setupAppContract.probeMesh)
  probeMesh() {
    return implement(setupAppContract.probeMesh).handler(async ({ input }) => ({
      status: 201 as const,
      headers: {},
      body: await this.forwardJson<ProbeMeshBody>("/setup/probe/mesh", "POST", input),
    }));
  }

  @Implement(setupAppContract.remoteAuth)
  remoteAuth() {
    return implement(setupAppContract.remoteAuth).handler(async ({ input }) => ({
      status: 201 as const,
      headers: {},
      body: await this.forwardJson<RemoteAuthBody>("/setup/remote/auth", "POST", input),
    }));
  }

  // ─── Trigger (OPENS THE GATE, then forwards) ────────────────────────────

  /**
   * `POST /setup/trigger` — the operator saying "these are my choices, go".
   *
   * The gate opens HERE, before forwarding, because the forward is what needs
   * the API to exist. Opening it afterwards would deadlock: the API would have
   * to be up to receive the trigger that starts it.
   *
   * ── WHY THE FORWARD IS BEST-EFFORT, AND WHY THAT IS NOT A SILENT FAILURE ──
   * This forward can only succeed if the API is ALREADY running, which is the
   * exception rather than the rule: in `prod` and `dev-supervised` the API is a
   * swarm service that this very trigger causes setup to schedule. So the normal
   * path is `getaddrinfo ENOTFOUND deployer-api`:
   *
   *   Upstream http://deployer-api:3005/setup/trigger unreachable:
   *   getaddrinfo ENOTFOUND deployer-api
   *
   * That is not a fault, and it was being REPORTED as one — the wizard showed
   * "The platform API is not reachable yet (…/setup/trigger) (retry)" at the end
   * of a run that then completed successfully, because the payload had already
   * been retained by the gate and was delivered seconds later by the handover:
   *
   *   [SetupGateService]      🚀 Setup trigger accepted — converging the swarm
   *   [WizardUpstreamService] Upstream …/setup/trigger unreachable: ENOTFOUND   ← noise
   *   [HandoverOrchestrator]  Setup trigger delivered — the API is provisioning ← real
   *
   * `SetupGateService.open()` persists the payload and `deliverTrigger()` retries
   * it against the API's real address until it is accepted. This forward is a
   * best-effort FAST PATH for the one profile where the API is already up
   * (plain `dev`, compose-managed). Failing it must therefore be reported as
   * "accepted, delivery pending" — never as an error the operator has to act on.
   *
   * The gate has ALREADY opened at this point, so the response is truthful:
   * `accepted: true` means the choices were taken, not that the API has them.
   */
  @Implement(setupAppContract.triggerInitialize)
  triggerInitialize() {
    return implement(setupAppContract.triggerInitialize).handler(async ({ input }) => {
      await this.gate.open(input);
      const delivered = await this.tryForwardTrigger(input);
      return {
        status: 201 as const,
        headers: {},
        body: { accepted: true, delivered },
      };
    });
  }

  /**
   * Forward the trigger if the API happens to be up; report whether it was.
   *
   * Never throws: the handover owns delivery, so a connection failure here is
   * "not yet", not "failed". A 4xx is different — the API is reachable and
   * REFUSING the payload, which retrying cannot fix, so that propagates.
   */
  private async tryForwardTrigger(input: unknown): Promise<boolean> {
    try {
      await this.upstream.forward("/setup/trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      this.logger.log("Setup trigger delivered directly — the API is provisioning");
      return true;
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.log(
        `Setup trigger accepted; direct delivery not possible yet (${reason}) — ` +
          "the handover will deliver it once the API is reachable",
      );
      return false;
    }
  }

  // ─── The orchestration stream ───────────────────────────────────────────

  /**
   * The setup progress stream: setup's own steps, then the API's forwarded.
   *
   * Emitted in order:
   *   1. `step_detail` for each step THIS profile performs
   *   2. `snapshot` marking them pending (so the wizard renders all of them)
   *   3. live `log` + `snapshot` events as setup does the work
   *   4. the API's frames, forwarded verbatim once it is up
   *
   * Steps 1–3 are why this is not a byte-pipe: the API cannot report on being
   * started, so setup reports that part itself using the SAME event schema.
   */
  @Implement(setupAppContract.getInitializeStream)
  getInitializeStream() {
    return implement(setupAppContract.getInitializeStream).handler(() =>
      this.stream.orchestratedStream(this.orchestration),
    );
  }

  // ─── Post-setup hints (forwarded) ───────────────────────────────────────

  @Implement(setupAppContract.listPostSetupHints)
  listPostSetupHints() {
    return implement(setupAppContract.listPostSetupHints).handler(() =>
      this.forwardJson("/setup/post-setup/hints", "GET", undefined),
    );
  }

  @Implement(setupAppContract.dismissPostSetupHint)
  dismissPostSetupHint() {
    return implement(setupAppContract.dismissPostSetupHint).handler(async ({ input }) => ({
      status: 201 as const,
      headers: {},
      body: await this.forwardJson<{ ok: boolean }>("/setup/post-setup/hints/dismiss", "POST", input),
    }));
  }

  // ─── Where the operator goes next (forwarded) ───────────────────────────

  /**
   * Relay the API's answer for the final "continue to dashboard" click.
   *
   * FORWARDED rather than computed locally. This app knows its OWN hostname but
   * nothing about whether a dashboard exists — that is a flag the API owns — and
   * guessing from the hostname is exactly what produced a 404 on the last click
   * of an "API only" setup.
   *
   * A failed forward falls back to THIS app's own origin instead of throwing:
   * the operator has just completed setup and must be able to leave, and the
   * wizard's done page is on this origin and therefore always answerable.
   */
  @Implement(setupAppContract.getPostSetupDestination)
  getPostSetupDestination() {
    return implement(setupAppContract.getPostSetupDestination).handler(async () => {
      try {
        return await this.forwardJson<SetupPostSetupDestination>(
          "/setup/post-setup/destination",
          "GET",
          undefined,
        );
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Post-setup destination unavailable (${reason}) — staying on the setup surface`);
        return {
          kind: "api-console" as const,
          url: this.upstream.baseUrl() + "/setup/done",
          managedWebEnabled: false,
        };
      }
    });
  }

  // ─── Forwarding helper ──────────────────────────────────────────────────

  /**
   * Forward a call to the API and return its JSON body.
   *
   * A transport failure becomes `SERVICE_UNAVAILABLE`, not a 500, because during
   * onboarding "the API is not up yet" is an EXPECTED state (it starts behind
   * the gate) — and the wizard renders that code as progress rather than as a
   * fault. That distinction only exists because the code is typed in the
   * contract.
   */
  private async forwardJson<T>(path: string, method: string, body: unknown): Promise<T> {
    const init: RequestInit = {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };

    let response: Response;
    try {
      response = await this.upstream.forward(path, init);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Upstream ${path} unreachable: ${reason}`);
      // `upstream.forward` already reports the FULL address it dialled
      // ("…deployer-api:3005/setup/trigger"). Re-stating the path here instead
      // threw that away and produced a message with an EMPTY host — a symptom
      // that pointed at routing rather than at the address actually used:
      //
      //   Error  The platform API is not reachable yet (/setup/trigger)
      //
      // So the upstream's own message is propagated verbatim and only padded
      // with our resolved address when it carries none.
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        message: reason.includes(" is not reachable yet")
          ? reason
          : `The platform API is not reachable yet (${this.upstream.urlFor(path)})`,
        data: { message: reason },
      });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      this.logger.warn(
        `Upstream ${path} answered ${String(response.status)}: ${text.slice(0, 200)}`,
      );
      // A reachable API refusing the request is a real contract error, so it is
      // surfaced rather than retried — resending an identical payload cannot fix
      // a 4xx.
      throw new ORPCError("BAD_GATEWAY", {
        message: `The platform API rejected ${path} (HTTP ${String(response.status)})`,
        data: { message: text.slice(0, 300) },
      });
    }

    return (await response.json()) as T;
  }
}
