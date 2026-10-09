/**
 * The handful of Docker Engine calls the agent needs, over the engine's unix socket.
 *
 * No SDK: the agent ships as one compiled binary, and five endpoints do not justify
 * a dependency tree. The interface is what the converger depends on, so tests use
 * an in-memory engine.
 */

const API_VERSION = "v1.44";

export type ContainerSummary = {
	id: string;
	running: boolean;
	labels: Record<string, string>;
	/** Networks the container is currently attached to. */
	networks: string[];
	/** Container ports (`80/tcp`) the engine currently publishes on the host. */
	publishedPorts: string[];
}

export type DockerEngine = {
	inspectContainer(name: string): Promise<ContainerSummary | null>;
	createContainer(name: string, spec: Record<string, unknown>): Promise<string>;
	startContainer(id: string): Promise<void>;
	removeContainer(id: string): Promise<void>;
	imageExists(image: string): Promise<boolean>;
	pullImage(image: string): Promise<void>;
	networkExists(name: string): Promise<boolean>;
	/** Name of a RUNNING container publishing `address:port` on the host, or null. */
	findPortHolder(address: string, port: number): Promise<string | null>;
}

export class DockerEngineError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "DockerEngineError";
	}
}

function splitImage(image: string): { fromImage: string; tag: string } {
	const at = image.indexOf("@");
	if (at !== -1) return { fromImage: image.slice(0, at), tag: image.slice(at + 1) };
	const slash = image.lastIndexOf("/");
	const colon = image.lastIndexOf(":");
	return colon > slash ? { fromImage: image.slice(0, colon), tag: image.slice(colon + 1) } : { fromImage: image, tag: "latest" };
}

/** Engine client over a unix socket, using Bun's `fetch({ unix })`. */
export class SocketDockerEngine implements DockerEngine {
	constructor(private readonly socketPath: string) {}

	private async request(method: string, path: string, body?: unknown): Promise<Response> {
		return fetch(`http://docker/${API_VERSION}${path}`, {
			method,
			unix: this.socketPath,
			headers: body === undefined ? undefined : { "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	}

	private async fail(response: Response): Promise<never> {
		const text = await response.text();
		let message = text;
		try {
			message = (JSON.parse(text) as { message?: string }).message ?? text;
		} catch {
			// not JSON — keep the raw text
		}
		throw new DockerEngineError(response.status, message.trim());
	}

	async inspectContainer(name: string): Promise<ContainerSummary | null> {
		const response = await this.request("GET", `/containers/${encodeURIComponent(name)}/json`);
		if (response.status === 404) return null;
		if (!response.ok) return this.fail(response);
		const body = (await response.json()) as {
			Id: string;
			State?: { Running?: boolean };
			Config?: { Labels?: Record<string, string> | null };
			NetworkSettings?: { Networks?: Record<string, unknown> | null; Ports?: Record<string, { HostPort?: string }[] | null> | null };
		};
		const ports = body.NetworkSettings?.Ports ?? {};
		return {
			id: body.Id,
			running: body.State?.Running === true,
			labels: body.Config?.Labels ?? {},
			networks: Object.keys(body.NetworkSettings?.Networks ?? {}),
			publishedPorts: Object.keys(ports).filter((key) => (ports[key] ?? []).length > 0),
		};
	}

	async createContainer(name: string, spec: Record<string, unknown>): Promise<string> {
		const response = await this.request("POST", `/containers/create?name=${encodeURIComponent(name)}`, spec);
		if (!response.ok) return this.fail(response);
		return ((await response.json()) as { Id: string }).Id;
	}

	async startContainer(id: string): Promise<void> {
		const response = await this.request("POST", `/containers/${id}/start`);
		if (!response.ok && response.status !== 304) await this.fail(response);
	}

	async removeContainer(id: string): Promise<void> {
		const response = await this.request("DELETE", `/containers/${id}?force=true`);
		if (!response.ok && response.status !== 404) await this.fail(response);
	}

	async imageExists(image: string): Promise<boolean> {
		const response = await this.request("GET", `/images/${encodeURIComponent(image)}/json`);
		return response.ok;
	}

	async pullImage(image: string): Promise<void> {
		const { fromImage, tag } = splitImage(image);
		const response = await this.request("POST", `/images/create?fromImage=${encodeURIComponent(fromImage)}&tag=${encodeURIComponent(tag)}`);
		if (!response.ok) await this.fail(response);
		// The engine streams progress; the pull is only finished when the stream is.
		const progress = await response.text();
		const failure = progress
			.split("\n")
			.filter((line) => line.includes('"error"'))
			.pop();
		if (failure !== undefined) throw new DockerEngineError(500, `pull ${image}: ${failure}`);
	}

	async networkExists(name: string): Promise<boolean> {
		const response = await this.request("GET", `/networks/${encodeURIComponent(name)}`);
		return response.ok;
	}

	async findPortHolder(address: string, port: number): Promise<string | null> {
		const response = await this.request("GET", "/containers/json");
		if (!response.ok) return this.fail(response);
		const containers = (await response.json()) as {
			Names?: string[];
			Ports?: { IP?: string; PublicPort?: number; Type?: string }[];
		}[];
		const wildcard = new Set(["", "0.0.0.0", "::"]);
		for (const container of containers) {
			const holds = (container.Ports ?? []).some(
				(published) =>
					published.Type === "tcp" &&
					published.PublicPort === port &&
					(wildcard.has(published.IP ?? "") || wildcard.has(address) || published.IP === address),
			);
			if (holds) return (container.Names?.[0] ?? "unknown").replace(/^\//, "");
		}
		return null;
	}
}
