# Project — Subagent 2/3: Web/Frontend Layer

## Pages: ~18 page.tsx files
- `projects/page.tsx` — list page, uses MOCK data (MOCK_PROJECTS, MOCK_SERVICES_BY_PROJECT)
- `projects/[projectId]/page.tsx` — detail, HYBRID (some real hooks + MOCK data)
- `projects/[projectId]/configuration/page.tsx` — FULLY MOCKED
- `projects/[projectId]/configuration/environments/[environmentId]/page.tsx` — FULLY MOCKED
- 10+ service sub-pages under `projects/[projectId]/services/` — ALL FULLY MOCKED
- 2 shared components (service-ops-overview-cards, service-dependency-graph)

## Domain Hooks: ~22 available
- Query hooks: useProjectList, useProject, useProjectCollaborators, useProjectEnvironments, useProjectEnvironment, useProjectVariableTemplates, useProjectGeneralConfig, useProjectEnvironmentConfig, useProjectDeploymentConfig, useProjectSecurityConfig, useProjectResourceConfig, useProjectNotificationConfig, useProjectEnvironmentStatus
- Mutation hooks: useCreateProject, useUpdateProject, useDeleteProject, useInviteProjectCollaborator, useUpdateProjectCollaborator, useRemoveProjectCollaborator, useCreateProjectEnvironment, useUpdateProjectEnvironment, useDeleteProjectEnvironment, useCloneProjectEnvironment, useCreateProjectVariableTemplate, useUpdateProjectVariableTemplate

## Current Status
- 0 pages use ONLY real hooks
- 1 page is HYBRID (project detail — some real, some mock)
- 17 pages are FULLY MOCKED
- 17 `from '@/mocks'` imports across project page files

## Web-specific Issues
- All project service pages use mock data
- Project detail page has mock-specific operations ("delete from mock dashboard")
- No loading/error/empty states on mocked pages
- No tests for project pages (0 spec files for pages)

## Todo List (Web Layer ONLY)
1. [XL] Migrate all 18 project pages from mock → real domain hooks
2. [M] Remove mock-specific strings ("mock dashboard", "Service created from mock dashboard action")
3. [L] Add loading/error/empty states to all project pages
4. [M] Add page-level tests for project pages
