import { Effect } from "effect";
import { SafeHttpError } from "./errors";
import { EgressPolicy } from "./policy";

export type HttpReq = {
  readonly method?: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
};

export type HttpRes = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  /** The final URL after redirects. */
  readonly url: string;
};

export type SafeHttpShape = {
  readonly request: (req: HttpReq, policy: EgressPolicy) => Effect.Effect<HttpRes, SafeHttpError>;
};

export type ResolvedAddress = { readonly address: string };

export type SafeHttpOptions = {
  /** Name resolution. Defaults to `Bun.dns.lookup`; injectable so specs and split-horizon setups need no real DNS. */
  readonly resolve?: (host: string) => Promise<readonly ResolvedAddress[]>;
  /** Extra CA certificate(s) (PEM) trusted for https, e.g. an internal platform CA. */
  readonly ca?: string | readonly string[];
};
