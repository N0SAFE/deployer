import { redirect } from 'next/navigation'

/**
 * Legacy route — the fleet view moved to /dashboard/nodes.
 * Kept as a redirect so bookmarks and old links keep working.
 */
export default function AdminServersRedirect() {
  redirect('/dashboard/nodes')
}
