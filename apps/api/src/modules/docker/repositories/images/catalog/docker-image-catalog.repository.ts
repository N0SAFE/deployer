import { Injectable } from "@nestjs/common";
import type { DockerImageListInput } from "@repo/api-contracts/modules/docker/images/list";
import type { DockerImage } from "@repo/contracts-entities";
import { DockerRepository } from "../../facade/docker.repository";
import { isRecord, isObjectLike } from "@repo/type-guards"

@Injectable()

/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys. Used in place of `as Record<string, unknown>`
 * to avoid the runtime lie.
 */
export class DockerImageCatalogRepository {
  constructor(private readonly dockerRepository: DockerRepository) {}

  listImages(
    ...args: Parameters<DockerRepository["listImages"]>
  ): ReturnType<DockerRepository["listImages"]> {
    return this.dockerRepository.listImages(...args);
  }

  inspectImage(
    ...args: Parameters<DockerRepository["inspectImage"]>
  ): ReturnType<DockerRepository["inspectImage"]> {
    return this.dockerRepository.inspectImage(...args);
  }

  filterImages(images: DockerImage[], input: DockerImageListInput): DockerImage[] {
    return images.filter((item) => {
      const registryFilter = this.getFilterValue(input, "registry");
      const repositoryFilter = this.getFilterValue(input, "repository");
      const tagFilter = this.getFilterValue(input, "tag");

      const registryMatch = this.includesIgnoreCase(item.registry, registryFilter);
      const repositoryMatch = this.includesIgnoreCase(item.repository, repositoryFilter);
      const tagMatch = this.includesIgnoreCase(item.tag ?? "", tagFilter);

      return registryMatch && repositoryMatch && tagMatch;
    });
  }

  sortImages(images: DockerImage[], input: DockerImageListInput): DockerImage[] {
    const direction = input.sortDirection === "asc" ? 1 : -1;
    const sortBy = input.sortBy ?? "lastSeenAt";

    const copy = [...images];
    copy.sort((left, right) => {
      const leftValue = this.resolveSortValue(left, sortBy);
      const rightValue = this.resolveSortValue(right, sortBy);

      return leftValue.localeCompare(rightValue) * direction;
    });

    return copy;
  }

  paginateImages(images: DockerImage[], input: DockerImageListInput) {
    const offset = Math.max(0, input.offset ?? 0);
    const limit = Math.max(1, input.limit ?? 20);
    const data = images.slice(offset, offset + limit);

    return {
      data,
      meta: {
        total: images.length,
        offset,
        limit,
      },
    };
  }

  private getFilterValue(input: DockerImageListInput, key: "registry" | "repository" | "tag"): string | null {
    const filter = input.filter;

    if (!filter || typeof filter !== "object") {
      return null;
    }

    const raw = (filter as Record<string, unknown>)[key];

    if (!raw || typeof raw !== "object") {
      return null;
    }

    const value = (raw as { value?: unknown }).value;
    if (typeof value !== "string") {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private includesIgnoreCase(candidate: string, needle: string | null): boolean {
    if (!needle) {
      return true;
    }

    return candidate.toLowerCase().includes(needle.toLowerCase());
  }

  private resolveSortValue(image: DockerImage, sortBy: DockerImageListInput["sortBy"]): string {
    switch (sortBy) {
      case "createdAt":
        return image.createdAt;
      case "registry":
        return image.registry;
      case "repository":
        return image.repository;
      case "lastSeenAt":
      default:
        return image.lastSeenAt;
    }
  }
}
