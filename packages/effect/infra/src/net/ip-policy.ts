export type AddressClass =
  | "public"
  | "loopback"
  | "private"
  | "link-local"
  | "cgnat"
  | "unspecified"
  | "multicast"
  | "reserved"
  | "metadata"
  | "invalid";

/** Cloud metadata endpoints that must stay unreachable even when private ranges are otherwise allowed. */
const METADATA_V4 = new Set(["169.254.169.254", "169.254.170.2", "100.100.100.200", "192.0.0.192"]);

const DOTTED_QUAD = /^\d{1,3}(\.\d{1,3}){3}$/;
const HEX_GROUP = /^[0-9a-fA-F]{1,4}$/;

/** Strict dotted-quad parser: four decimal octets, nothing else (no hex/octal/integer forms). */
const parseV4 = (ip: string): [number, number, number, number] | undefined => {
  if (!DOTTED_QUAD.test(ip)) return undefined;
  const [a, b, c, d] = ip.split(".").map(Number);
  if (a === undefined || b === undefined || c === undefined || d === undefined) return undefined;
  return [a, b, c, d].every((p) => p <= 255) ? [a, b, c, d] : undefined;
};

/** Expand an IPv6 literal to 8 16-bit groups; handles `::`, brackets, a zone id and an embedded dotted IPv4 tail. */
const parseV6 = (input: string): number[] | undefined => {
  let text = input.replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  if (!text.includes(":")) return undefined;

  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1];
  if (dotted !== undefined) {
    const v4 = parseV4(dotted);
    if (v4 === undefined) return undefined;
    text = text.slice(0, -dotted.length) + `${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const [first = "", second = ""] = halves;
  const head = first === "" ? [] : first.split(":");
  const tail = halves.length === 2 ? (second === "" ? [] : second.split(":")) : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0 || (halves.length === 2 && missing < 1)) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || !groups.every((g) => HEX_GROUP.test(g))) return undefined;
  return groups.map((g) => parseInt(g, 16));
};

/** True when `host` is an IPv4 or IPv6 literal (brackets and zone ids tolerated). */
export const isIpLiteral = (host: string): boolean => parseV4(host) !== undefined || parseV6(host) !== undefined;

const classifyV4 = (v4: [number, number, number, number]): AddressClass => {
  const [a, b] = v4;
  if (METADATA_V4.has(v4.join("."))) return "metadata";
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 169 && b === 254) return "link-local";
  if (a === 100 && b >= 64 && b <= 127) return "cgnat";
  if (a >= 224 && a <= 239) return "multicast";
  if (a >= 240) return "reserved";
  if (a === 192 && b === 0 && v4[2] === 0) return "reserved"; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && v4[2] === 2) return "reserved"; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return "reserved"; // benchmarking
  if (a === 198 && b === 51 && v4[2] === 100) return "reserved"; // TEST-NET-2
  if (a === 203 && b === 0 && v4[2] === 113) return "reserved"; // TEST-NET-3
  return "public";
};

/**
 * Classify an IP literal. Anything that is not clearly a public unicast address is
 * non-public, and unparseable input is `invalid` (denied by every policy).
 */
export const classifyAddress = (address: string): AddressClass => {
  const v4 = parseV4(address);
  if (v4 !== undefined) return classifyV4(v4);

  const g = parseV6(address);
  if (g === undefined) return "invalid";
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;

  if (g.every((x) => x === 0)) return "unspecified";
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return "loopback";
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::/96) inherit the embedded IPv4 class.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return classifyV4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  }
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return classifyV4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  }
  if (g0 === 0xfd00 && g1 === 0x0ec2) return "metadata"; // AWS IMDS over IPv6
  if ((g0 & 0xfe00) === 0xfc00) return "private"; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return "link-local"; // fe80::/10
  if ((g0 & 0xff00) === 0xff00) return "multicast";
  if (g0 === 0x2001 && g1 === 0x0db8) return "reserved"; // documentation
  if ((g0 & 0xe000) !== 0x2000) return "reserved"; // outside 2000::/3 global unicast
  return "public";
};

export const isPublicAddress = (address: string): boolean => classifyAddress(address) === "public";
