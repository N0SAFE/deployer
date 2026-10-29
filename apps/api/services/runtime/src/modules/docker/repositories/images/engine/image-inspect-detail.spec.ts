import { Effect } from "effect";
import { DockerEngine } from "@deployer/docker";
import { describe, expect, it } from "vitest";

import { DockerImagesRepository, ImageNotFound } from "./docker-images.repository";
import {
  buildImageInspectDetail,
  containersUsingImage,
  identifyInspectedImage,
  scanTargetsOf,
} from "./image-inspect-detail";

const inspect = {
  Id: "sha256:abc",
  RepoTags: ["ghcr.io/acme/api:1.0", "<none>:<none>"],
  RepoDigests: ["ghcr.io/acme/api@sha256:def"],
  Created: "2026-09-01T00:00:00.000Z",
  Size: 1024,
  Architecture: "amd64",
  Os: "linux",
  Config: { Labels: { a: "b" }, Env: ["X=1"], ExposedPorts: { "80/tcp": {} }, Cmd: ["run"], User: "app" },
  RootFS: { Type: "layers", Layers: ["l1", "l2"] },
} as never;

describe("image inspect detail", () => {
  const identity = identifyInspectedImage(inspect, "requested");

  it("identifies the image from its id, tags and digests", () => {
    expect(identity).toMatchObject({
      inspectId: "sha256:abc",
      repoTags: ["ghcr.io/acme/api:1.0"],
      registry: "ghcr.io",
      repository: "acme/api",
      tag: "1.0",
    });
    expect(identifyInspectedImage({ ...(inspect as object), Id: "" } as never, "requested").inspectId).toBe("requested");
  });

  it("lists the scan targets once, id first", () => {
    expect(scanTargetsOf(identity)).toEqual(["sha256:abc", "ghcr.io/acme/api:1.0"]);
  });

  it("finds the containers using the image by id or by tag", () => {
    const containers = [
      { Id: "c1", ImageID: "sha256:abc", Image: "x" },
      { Id: "c2", ImageID: "", Image: "ghcr.io/acme/api:1.0" },
      { Id: "c3", ImageID: "other", Image: "y" },
      { Id: "c1", ImageID: "sha256:abc", Image: "x" },
    ] as never;
    expect(containersUsingImage(containers, identity)).toEqual(["c1", "c2"]);
  });

  it("builds the detail with layers, runtime config and the scan", () => {
    const detail = buildImageInspectDetail({
      inspect,
      identity,
      generatedAt: "2026-10-01T00:00:00.000Z",
      usedByContainerIds: ["c1"],
      securityScan: { vulnerabilities: [], scanSummary: null } as never,
    });
    expect(detail.layers.map((layer) => layer.id)).toEqual(["l1", "l2"]);
    expect(detail.createdAt).toBe("2026-09-01T00:00:00.000Z");
    expect(detail.runtimeConfig).toMatchObject({ env: ["X=1"], exposedPorts: ["80/tcp"], user: "app" });
    expect(detail.usedByContainerIds).toEqual(["c1"]);
  });
});

describe("DockerImagesRepository.inspectResolved", () => {
  const run = (engine: unknown, id: string) =>
    Effect.runPromiseExit(DockerImagesRepository.live.inspectResolved(id).pipe(Effect.provideService(DockerEngine, engine as never)));

  it("finds the image from the engine's own list when the reference does not inspect", async () => {
    const engine = {
      images: {
        inspect: (ref: string) => (ref === "sha256:abc" ? Effect.succeed(inspect) : Effect.fail(new Error("no"))),
        list: () => Effect.succeed([{ Id: "sha256:abc", RepoTags: ["ghcr.io/acme/api:1.0"], RepoDigests: [] }]),
      },
    };
    const exit = await run(engine, "ghcr.io/acme/api:1.0");
    expect(exit._tag).toBe("Success");
  });

  it("fails with ImageNotFound when nothing inspects", async () => {
    const engine = { images: { inspect: () => Effect.fail(new Error("no")), list: () => Effect.succeed([]) } };
    const exit = await run(engine, "ghost");
    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("ImageNotFound");
    expect(new ImageNotFound({ imageId: "ghost" })._tag).toBe("ImageNotFound");
  });
});
