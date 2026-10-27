import { Controller } from "@nestjs/common";
import { implement } from "@orpc/server";
import { authContract } from "../../contracts/auth.contract";
import { Implement } from "@orpc/nest";
import { requireSession } from "../../orpc/require-session";

@Controller()
export class AuthController {
  @Implement(authContract.me)
  me() {
    return implement(authContract.me)
      .use(requireSession)
      .handler(({ context }) => ({
        id: context.auth.user.id,
        email: context.auth.user.email,
        name: context.auth.user.name,
      }));
  }

  @Implement(authContract.whoami)
  whoami() {
    return implement(authContract.whoami).handler(({ context }) => ({
      authenticated: context.auth.isLoggedIn,
      email: context.auth.user?.email ?? null,
    }));
  }
}
