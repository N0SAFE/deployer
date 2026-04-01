import { z } from 'zod'
import { platformDomainSchemas } from '../contracts/platform-domain.builder'

export type MockOrganization = z.infer<typeof platformDomainSchemas.mockOrganizationSchema>
export type MockTeam = z.infer<typeof platformDomainSchemas.mockTeamSchema>
export type MockProject = z.infer<typeof platformDomainSchemas.mockProjectSchema>
export type FixtureGroupMemberService = z.infer<typeof platformDomainSchemas.fixtureGroupMemberServiceSchema>
export type FixtureGroupMemberDependency = z.infer<typeof platformDomainSchemas.fixtureGroupMemberDependencySchema>
export type FixtureServiceGroupDefinition = z.infer<typeof platformDomainSchemas.fixtureServiceGroupDefinitionSchema>
export type FixtureService = z.infer<typeof platformDomainSchemas.fixtureServiceSchema>
export type FixtureDependency = z.infer<typeof platformDomainSchemas.fixtureDependencySchema>
export type EnvPolicy = z.infer<typeof platformDomainSchemas.envPolicySchema>
export type EnvPolicyMap = z.infer<typeof platformDomainSchemas.envPolicyMapSchema>
export type DependencyPolicyAdvanced = z.infer<typeof platformDomainSchemas.dependencyPolicyAdvancedSchema>
export type ServiceHealthCheckConfig = z.infer<typeof platformDomainSchemas.serviceHealthCheckConfigSchema>
export type ServiceEnvironmentRuntimeStatus = z.infer<
  typeof platformDomainSchemas.serviceEnvironmentRuntimeStatusSchema
>
export type ServiceRuntimeStatusByEnvironment = z.infer<typeof platformDomainSchemas.serviceRuntimeStatusByEnvironmentSchema>
export type ServiceExecutionOverridesByEnvironment = z.infer<
  typeof platformDomainSchemas.serviceExecutionOverridesByEnvironmentSchema
>
export type ServiceConfigEntry = z.infer<typeof platformDomainSchemas.serviceConfigEntrySchema>
export type MockServiceProvider = z.infer<typeof platformDomainSchemas.mockServiceProviderSchema>
export type MockServiceRunner = z.infer<typeof platformDomainSchemas.mockServiceRunnerSchema>
export type ProjectConfiguration = z.infer<typeof platformDomainSchemas.projectConfigurationSchema>
export type MockDeployment = z.infer<typeof platformDomainSchemas.mockDeploymentSchema>
export type MockIncident = z.infer<typeof platformDomainSchemas.mockIncidentSchema>
export type MockNotification = z.infer<typeof platformDomainSchemas.mockNotificationSchema>
export type DependencyGraphMockScenario = z.infer<typeof platformDomainSchemas.dependencyGraphMockScenarioSchema>
export type PlatformMockOverview = z.infer<typeof platformDomainSchemas.platformMockOverviewSchema>
