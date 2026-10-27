import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";
import { AUTH } from "./auth.token";
import type { Auth } from "./auth";

/**
 * Resolves the Better Auth session exactly once per request and attaches it to
 * the Node request. Everything downstream — the oRPC context, Nest handlers —
 * reads that single result instead of calling Better Auth again.
 *
 * No credentials → no lookup. Missing session is not an error here: this
 * middleware only populates, enforcement belongs to the oRPC `requireSession`
 * middleware so the client always receives a contract-defined `UNAUTHORIZED`.
 */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(@Inject(AUTH) private readonly auth: Auth) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const hasCredentials = Boolean(req.headers.cookie ?? req.headers.authorization);

    req.session = hasCredentials
      ? await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
      : null;
    req.user = req.session?.user;

    next();
  }
}
