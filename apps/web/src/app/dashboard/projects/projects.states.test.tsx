import '@/test-support/mocks'
import { describePageStates } from '@/test-support'
import { PROJECT_ID } from '@/test-support/fixtures/projects'

import ProjectDeploymentsPage from './[projectId]/deployments/page'
import ProjectDomainsPage from './[projectId]/domains/page'
import DashboardProjectEnvironmentsPage from './[projectId]/environments/page'
import DashboardProjectOverviewPage from './[projectId]/page'
import DashboardProjectServicesPage from './[projectId]/services/page'
import ProjectTeamPage from './[projectId]/team/page'
import DashboardProjectsPage from './page'

const params = { projectId: PROJECT_ID }

describePageStates('Projects list', {
    page: () => <DashboardProjectsPage />,
    empty: { action: /create your first project|new project/i },
})

describePageStates('Project overview', {
    page: () => <DashboardProjectOverviewPage />,
    params,
    empty: { action: /create a service|open services/i },
    variants: [
        {
            name: 'project not found',
            hooks: {},
            data: { useProject: undefined },
            expect: 'error',
            noRetry: 'a missing project has nothing to retry',
        },
    ],
})

describePageStates('Project deployments', {
    page: () => <ProjectDeploymentsPage />,
    params,
    empty: { action: /deploy|service|trigger|create/i },
})

describePageStates('Project services', {
    page: () => <DashboardProjectServicesPage />,
    params,
    empty: { action: /create|add|new service/i },
})

describePageStates('Project environments', {
    page: () => <DashboardProjectEnvironmentsPage />,
    params,
    empty: { action: /create|add|new environment/i },
})

describePageStates('Project team', {
    page: () => <ProjectTeamPage />,
    params,
    empty: { action: /invite/i },
})

describePageStates('Project domains', {
    page: () => <ProjectDomainsPage />,
    params,
    empty: { action: /add domain/i },
})
