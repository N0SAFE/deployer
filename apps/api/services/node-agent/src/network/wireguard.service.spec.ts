import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { MESH_INTERFACE_MTU, parseWireguardDump, renderWireguardConfig } from "./wireguard";
import { HostCommands, WireguardCommandError, WireguardDriver, WireguardPaths } from "./wireguard.service";

type Call = readonly [string, readonly string[]];

const DUMP = [
	"privkey\tpubkey\t51820\toff",
	"peerkey\t(none)\t10.9.0.2:51820\t10.9.0.2/32\t1700000000\t1024\t2048\t25",
	"silent\t(none)\t(none)\t(none)\t0\t0\t0\toff",
].join("\n");

function scripted(answers: (call: Call) => { code?: number; stdout?: string; stderr?: string }) {
	const calls: Call[] = [];
	const run = (command: string, args: readonly string[]) => {
		calls.push([command, args]);
		const answer = answers([command, args]);
		return Effect.succeed({ code: answer.code ?? 0, stdout: answer.stdout ?? "", stderr: answer.stderr ?? "" });
	};
	return { calls, run };
}

const paths = { interfaceName: "wg-test", configPath: "/tmp/mesh-wg-test.conf" };

const withPorts = <A, E>(
	effect: Effect.Effect<A, E, HostCommands | WireguardPaths>,
	run: ReturnType<typeof scripted>["run"],
) =>
	Effect.runPromise(
		effect.pipe(
			Effect.provideService(HostCommands, { run, runWithInput: (command, args) => run(command, args) }),
			Effect.provideService(WireguardPaths, paths),
		) as Effect.Effect<A, E>,
	);

describe("WireguardDriver.kernel", () => {
	it("creates the interface, replaces its address and brings it up", async () => {
		const fake = scripted(([command, args]) => {
			if (command === "ip" && args[0] === "link" && args[1] === "show") return { code: 1 };
			if (command === "ip" && args[0] === "-o") return { stdout: "5: wg-test    inet 10.9.0.9/24" };
			return {};
		});

		await withPorts(WireguardDriver.kernel.ensureInterface("10.9.0.1", 24), fake.run);

		expect(fake.calls.map(([command, args]) => `${command} ${args.join(" ")}`)).toEqual([
			"ip link show dev wg-test",
			"ip link add dev wg-test type wireguard",
			"ip -o -4 address show dev wg-test",
			"ip address flush dev wg-test",
			"ip address add 10.9.0.1/24 dev wg-test",
			`ip link set dev wg-test mtu ${String(MESH_INTERFACE_MTU)} up`,
		]);
	});

	it("leaves a correct address alone", async () => {
		const fake = scripted(([command, args]) => {
			if (command === "ip" && args[0] === "-o") return { stdout: "5: wg-test    inet 10.9.0.1/24" };
			return {};
		});

		await withPorts(WireguardDriver.kernel.ensureInterface("10.9.0.1", 24), fake.run);

		expect(fake.calls.map(([command, args]) => args.join(" "))).not.toContain("address flush dev wg-test");
	});

	it("applies a config with syncconf and writes it 0600", async () => {
		const fake = scripted(() => ({}));
		const config = renderWireguardConfig({ privateKey: "priv", listenPort: 51820, peers: [] });

		await withPorts(WireguardDriver.kernel.syncConfig(config), fake.run);

		expect(fake.calls).toEqual([["wg", ["syncconf", "wg-test", "/tmp/mesh-wg-test.conf"]]]);
	});

	it("parses the dump, and treats a missing interface as absent", async () => {
		const present = scripted(() => ({ stdout: DUMP }));
		const parsed = await withPorts(WireguardDriver.kernel.dump(), present.run);

		expect(parsed?.listenPort).toBe(51820);
		expect(parsed?.peers.peerkey?.rxBytes).toBe(1024);
		expect(parsed?.peers.peerkey?.latestHandshakeAt).toBe(1_700_000_000_000);
		expect(parsed?.peers.silent?.endpoint).toBeNull();

		const absent = scripted(() => ({ code: 1, stderr: "Unable to access interface" }));
		expect(await withPorts(WireguardDriver.kernel.dump(), absent.run)).toBeNull();
	});

	it("fails with the command and its stderr when the kernel refuses", async () => {
		const fake = scripted(([command]) =>
			command === "ip" ? { code: 2, stderr: "RTNETLINK answers: Operation not permitted" } : {},
		);

		const error = await Effect.runPromise(
			Effect.flip(WireguardDriver.kernel.ensureInterface("10.9.0.1", 24)).pipe(
				Effect.provideService(HostCommands, { run: fake.run, runWithInput: (command, args) => fake.run(command, args) }),
				Effect.provideService(WireguardPaths, paths),
			) as Effect.Effect<WireguardCommandError>,
		);

		expect(error).toBeInstanceOf(WireguardCommandError);
		expect(error.command).toContain("ip link add");
		expect(error.stderr).toContain("Operation not permitted");
	});
});

describe("WireguardDriver.observeOnly", () => {
	it("never touches the host", async () => {
		const fake = scripted(() => ({}));

		expect(await withPorts(WireguardDriver.observeOnly.dump(), fake.run)).toBeNull();
		await withPorts(WireguardDriver.observeOnly.ensureInterface("10.9.0.1", 24), fake.run);

		expect(fake.calls).toHaveLength(0);
	});
});

describe("wire formats", () => {
	it("renders a syncconf file", () => {
		const rendered = renderWireguardConfig({
			privateKey: "priv",
			listenPort: 51820,
			peers: [{ wireguardKey: "pub", allowedIps: ["10.9.0.2/32"], endpoint: "1.2.3.4:51820", persistentKeepaliveSeconds: 25 }],
		});

		expect(rendered).toContain("[Interface]");
		expect(rendered).toContain("Endpoint = 1.2.3.4:51820");
		expect(rendered.endsWith("\n")).toBe(true);
	});

	it("returns null for output that is not a dump", () => {
		expect(parseWireguardDump("")).toBeNull();
		expect(parseWireguardDump("garbage")).toBeNull();
		expect(parseWireguardDump("priv\tpub\tnot-a-port")).toBeNull();
	});
});
