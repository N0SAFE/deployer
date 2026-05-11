import { redirect } from 'next/navigation'

export default function DashboardDockerQueuPageRedirect() {
  redirect('/dashboard/docker/activity')
}
