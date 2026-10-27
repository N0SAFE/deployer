import { describe, expect, it } from "vitest";

import { classifyAddress, isPublicAddress } from "./ip-policy";

describe("classifyAddress", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["10.0.0.5", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["172.32.0.1", "public"],
    ["192.168.1.1", "private"],
    ["169.254.10.10", "link-local"],
    ["169.254.169.254", "metadata"],
    ["100.100.100.200", "metadata"],
    ["100.64.0.1", "cgnat"],
    ["100.128.0.1", "public"],
    ["0.0.0.0", "unspecified"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "reserved"],
    ["192.0.2.1", "reserved"],
    ["198.18.0.1", "reserved"],
    ["8.8.8.8", "public"],
    ["1.1.1.1", "public"],
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["fe80::1", "link-local"],
    ["fd12:3456::1", "private"],
    ["fc00::1", "private"],
    ["fd00:ec2::254", "metadata"],
    ["ff02::1", "multicast"],
    ["2001:db8::1", "reserved"],
    ["2606:4700:4700::1111", "public"],
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:10.1.2.3", "private"],
    ["::ffff:169.254.169.254", "metadata"],
    ["::ffff:8.8.8.8", "public"],
    ["64:ff9b::a00:1", "private"],
    ["[::1]", "loopback"],
    ["fe80::1%eth0", "link-local"],
  ] as const)("%s is %s", (address, expected) => {
    expect(classifyAddress(address)).toBe(expected);
  });

  it.each(["", "not-an-ip", "999.1.1.1", "1.2.3", "1.2.3.4.5", "::g", "1::2::3", "0x7f.0.0.1", "2130706433"])(
    "treats %j as invalid (never public)",
    (address) => {
      expect(classifyAddress(address)).toBe("invalid");
      expect(isPublicAddress(address)).toBe(false);
    },
  );
});
