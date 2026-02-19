import { TraefikDashboardClient } from '@/components/traefik/TraefikDashboardClient'
import { DashboardTraefik } from '@/routes/index'

export default DashboardTraefik.Page(async function TraefikPage() {
  return <TraefikDashboardClient />
})