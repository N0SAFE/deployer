import {
  All,
  Controller,
  Get,
  Logger,
  Param,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Render as SsrRender } from "@nestjs-ssr/react";
import { Subject } from "rxjs";

import SetupView from "@/views/pages/setup";
import { SetupGateService } from "./setup-gate.service";
import { WizardStreamService } from "./wizard-stream.service";
import { WizardUpstreamService } from "./wizard-upstream.service";

/** Paths the wizard contract exposes, proxied 1:1 to the full API. */
const API_PATHS = [
  "state",
  "node-status",
  "probe/database",
  "probe/mesh",
  "remote/auth",
  "trigger",
  "post-setup/hints",
  "post-setup/hints/dismiss",
] as const;

/**
 * The wizard's HTTP surface, served BY THE SETUP APP.
 *
 * WHY THE WIZARD LIVES HERE AND NOT IN THE API
 * Setup is the one phase where no product surface can be assumed to exist: the
 * web app is activated THROUGH onboarding, and the API is not the ingress
 * target yet. The setup app is the only process answering on
 * `setup.<host>` during this phase, so it is the only one that can serve the
 * page — and, because the browser's connection terminates HERE, the ingress
 * handover at the end cannot interrupt a wizard the operator is watching
 * (plan §9.3).
 *
 * WHY THE HANDLERS ARE A THIN PROXY
 * Provisioning needs the Drizzle schema, migrations and the auth stack, so the
 * API remains the only EXECUTOR. This controller forwards each contract path
 * verbatim — including the SSE stream, which it pipes rather than re-produces
 * (plan §10.1) — so the wizard contract keeps exactly one implementation.
 */
@Controller()
export class WizardController {
  private readonly logger = new Logger(WizardController.name);

  constructor(
    private readonly upstream: WizardUpstreamService,
    private readonly stream: WizardStreamService,
    private readonly gate: SetupGateService,
  ) {}

  // ─── The wizard page ──────────────────────────────────────────────────────

  /**
   * `GET /` — the onboarding page.
   *
   * `layout: null`: the wizard is a full-page, focused experience with no
   * console chrome, matching what the web app used to render.
   *
   * `needsSetup` is always `true` here: this app only exists while setup is
   * pending, so the "already done" branch the API needed is unreachable. The
   * page keeps its own guard so the component stays usable from either host.
   */
  @Get()
  @SsrRender(SetupView, { layout: null })
  setupPage(): { needsSetup: boolean } {
    return { needsSetup: true };
  }

  // ─── The SSE stream (piped, never re-produced) ─────────────────────────────

  /**
   * `GET /setup/stream` — pipes the API's provisioning events to the client.
   *
   * Declared BEFORE the generic proxy so it wins the route match: it is the one
   * path that needs special handling (streaming, `Last-Event-ID`, teardown on
   * disconnect) rather than a straight forward.
   *
   * WHY `@Res()` AND NOT A RETURNED Observable: Nest's SSE helper consumes an
   * Observable and writes its own framing. The upstream frames are ALREADY
   * framed for the client, so re-framing them would corrupt multi-line payloads
   * — the raw response is the only correct sink.
   */
  @Get("setup/stream")
  async pipeStream(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Disable proxy buffering: a buffering intermediary would hold the frames
    // and make the progress view appear frozen until the stream ended.
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // The client disconnecting must cancel the UPSTREAM subscription too — see
    // `pipeTo`, which is where the teardown is wired.
    const clientGone = new Subject<void>();
    req.on("close", () => {
      clientGone.next();
      clientGone.complete();
    });

    const lastEventId = req.header("last-event-id");
    await this.stream.pipeTo(res, clientGone, lastEventId);
  }

  // ─── Contract proxy ───────────────────────────────────────────────────────

  /**
   * Forward a wizard contract call to the API and relay its response.
   *
   * The status code is carried through UNCHANGED, because the wizard reads it:
   * a 503 here means "the API is not up yet", which the UI renders as progress
   * rather than as a failure. Collapsing everything to 200 would erase that.
   */
  @All("setup/*path")
  async proxy(
    @Param("path") path: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!(API_PATHS as readonly string[]).includes(path)) {
      // An unknown path is a 404, not a blind forward: proxying arbitrary paths
      // would turn this app into an open relay to the API.
      res.status(404).json({ message: `Unknown setup path: ${path}` });
      return;
    }

    // ── THE GATE ────────────────────────────────────────────────────────────
    // `POST /setup/trigger` is the operator saying "these are my choices, go".
    // That is the moment the API may start, so the gate opens HERE — before the
    // call is forwarded, because the forward is what needs the API to exist.
    //
    // Opening it AFTER forwarding would deadlock: the API would have to be up
    // to receive the trigger that starts it.
    if (path === "trigger" && req.method === "POST") {
      await this.gate.open(req.body);
    }

    const init: RequestInit = {
      method: req.method,
      headers: this.forwardHeaders(req),
      body: this.forwardBody(req),
    };

    const upstream = await this.upstream.forward(`/setup/${path}`, init);
    const body = await upstream.text();

    res.status(upstream.status);
    // Carry the upstream content type; default to JSON for a bodyless response.
    res.type(upstream.headers.get("content-type") ?? "application/json");
    res.send(body);
  }

  /**
   * Copy only the headers that describe the PAYLOAD and CREDENTIALS.
   *
   * A blanket spread would forward `host`, `connection` and `content-length`
   * from the original request, and `content-length` would then describe a body
   * we may have re-serialized — a desync the upstream would reject or, worse,
   * read as truncated.
   */
  private forwardHeaders(req: Request): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const name of ["content-type", "accept", "cookie", "authorization"]) {
      const value = req.header(name);
      if (value !== undefined) headers[name] = value;
    }
    return headers;
  }

  /**
   * Forward the request body as a string, so the upstream parses it exactly as
   * it would have if the client had called it directly.
   *
   * Express's JSON parser has already consumed the stream, so the parsed object
   * is re-serialized rather than re-piped. GET/DELETE carry no body.
   */
  private forwardBody(req: Request): string | undefined {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "DELETE") {
      return undefined;
    }
    const body: unknown = req.body;
    if (body === undefined || body === null) return undefined;
    if (typeof body === "string") return body;
    return JSON.stringify(body);
  }
}
