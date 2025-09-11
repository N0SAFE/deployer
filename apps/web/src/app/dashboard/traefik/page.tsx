import { TraefikDashboardClient } from '@/components/traefik/TraefikDashboardClient'
import { DashboardTraefik } from '@/routes/index'

export default DashboardTraefik.Page(async function TraefikPage() {
  const startTime = Date.now()
  
  console.log('🔄 [Traefik] Starting file system tree viewer...')
  
  const endTime = Date.now()
  console.log(`✅ [Traefik] File system tree viewer loaded in ${endTime - startTime}ms`)

  return <TraefikDashboardClient />
})