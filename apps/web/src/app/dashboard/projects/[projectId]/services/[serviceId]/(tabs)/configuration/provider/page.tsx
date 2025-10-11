import { DashboardProjectsProjectIdServicesServiceIdTabsConfigurationProvider } from '@/routes'
import { ProviderConfigurationClient } from './ProviderConfigurationClient'

export default DashboardProjectsProjectIdServicesServiceIdTabsConfigurationProvider.Page(
    async function ProviderConfigurationPage({ params }) {
        return <ProviderConfigurationClient params={await params} />
    }
)
