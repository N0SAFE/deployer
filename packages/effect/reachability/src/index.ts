export {
  probeAddress,
  probePeer,
  PeerIdentity,
  type AddressProbeResult,
  type ProbeAddressOptions,
  type PeerProbeResult,
  type ProbePeerOptions,
} from "./probe";

/** Address helpers live in `@deployer/effect-infra` (they share `ip-policy` with `SafeHttp`). */
export { hostOf, isIpAddress, toOrigin } from "@deployer/effect-infra";
