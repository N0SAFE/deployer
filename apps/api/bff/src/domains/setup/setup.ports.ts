import { Context } from "effect";

import type { EnvService } from "@/config/env/env.module";
import type { HostnameService } from "@/core/modules/platform-ingress/services/hostname.service";
import type { PlatformConfigServiceShape } from "@/core/modules/platform-ingress/services/platform-config.service";
import type { IngressTransport } from "./services/post-setup-verification.service";

/**
 * What the post-setup services read, as Effect ports. Each is bound in `SetupDomainModule` with `useExisting` to the
 * Promise-based provider that owns it, so the services never import Nest and a spec substitutes a plain object.
 */
export class SetupEnvPort extends Context.Service<SetupEnvPort, EnvService>()("bff/SetupEnvPort") {}
export class SetupHostnamePort extends Context.Service<SetupHostnamePort, HostnameService>()("bff/SetupHostnamePort") {}
export class SetupPlatformConfigPort extends Context.Service<SetupPlatformConfigPort, PlatformConfigServiceShape>()("bff/SetupPlatformConfigPort") {}
/** How the verification reaches the cluster ingress (node `http` in production, a fake in a spec). */
export class SetupTransportPort extends Context.Service<SetupTransportPort, IngressTransport>()("bff/SetupTransportPort") {}
