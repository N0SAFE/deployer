import '@/test-support/mocks'
import { asComponent, describePageStates } from '@/test-support'
import DashboardDockerPage from './page'
import DashboardDockerContainersPage from './containers/page'
import DashboardDockerImagesPage from './images/page'
import DashboardDockerNetworksPage from './networks/page'
import DashboardDockerVolumesPage from './volumes/page'
import DashboardDockerLogsPage from './logs/page'
import DashboardDockerActivityPage from './activity/page'
import DashboardDockerShellPage from './shell/page'

describePageStates('Docker overview', {
	page: () => <DashboardDockerPage />,
	empty: { action: /all containers|projects|cluster/i },
})
describePageStates('Docker containers', {
	page: () => {
		const Page = asComponent(DashboardDockerContainersPage)
		return <Page />
	},
	empty: { action: /create|run|new/i },
})
describePageStates('Docker images', {
	page: () => {
		const Page = asComponent(DashboardDockerImagesPage)
		return <Page />
	},
	empty: { action: /pull|create|run|deploy/i },
})
describePageStates('Docker networks', {
	page: () => <DashboardDockerNetworksPage />,
	empty: { action: /refresh|create/i },
})
describePageStates('Docker volumes', {
	page: () => <DashboardDockerVolumesPage />,
	empty: { action: /refresh|create/i },
})
describePageStates('Docker logs', {
	page: () => <DashboardDockerLogsPage />,
	empty: { action: /containers|deploy|projects/i },
})
describePageStates('Docker activity', {
	page: () => <DashboardDockerActivityPage />,
	empty: { action: /.+/ },
})
describePageStates('Docker shell', {
	page: () => <DashboardDockerShellPage />,
	empty: { action: /containers|deploy|projects/i },
})
