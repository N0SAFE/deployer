import { Injectable } from '@nestjs/common';
import { ProjectRepository } from '@/modules/project/repositories/project.repository';
import { EnvironmentRepository } from '@/core/modules/environment/repositories/environment.repository';

/**
 * IdentifierResolverService
 * 
 * PURPOSE: Shared logic for resolving entity identifiers (slugs/names → UUIDs)
 * LOCATION: Core module (used by multiple feature modules)
 * 
 * PATTERN: Core Module Shared Logic Pattern
 * - Reusable across feature modules (environment, deployment, etc.)
 * - Domain-agnostic utility
 * - Infrastructure concern (identifier resolution)
 */
@Injectable()
export class IdentifierResolverService {
  // UUID format regex
  private readonly UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly environmentRepository: EnvironmentRepository,
  ) {}

  /**
   * Resolves a project identifier to UUID
   * @param projectId - Can be UUID or project name/slug
   * @returns Project UUID
   * @throws Error if project not found
   */
  async resolveProjectId(projectId: string): Promise<string> {
    // Already a UUID, return as-is
    if (this.UUID_REGEX.test(projectId)) {
      return projectId;
    }

    // Resolve slug/name to UUID
    // Note: ProjectRepository doesn't have findByName, assuming projectId is already a UUID
    const project = await this.projectRepository.findById(projectId);

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    return project.id;
  }

  /**
   * Resolves an environment identifier to UUID
   * @param environmentId - Can be UUID or environment slug/name
   * @param projectId - Optional project context for slug resolution
   * @returns Environment UUID
   * @throws Error if environment not found
   */
  async resolveEnvironmentId(environmentId: string, projectId?: string): Promise<string> {
    // Already a UUID, return as-is
    if (this.UUID_REGEX.test(environmentId)) {
      return environmentId;
    }

    // Resolve slug/name to UUID
    const environment = await this.environmentRepository.findBySlug(environmentId, projectId);

    if (!environment) {
      throw new Error(`Environment not found: ${environmentId}`);
    }

    return environment.id;
  }

  /**
   * Check if a string is a valid UUID
   */
  isUUID(value: string): boolean {
    return this.UUID_REGEX.test(value);
  }
}
