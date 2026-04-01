import { redirect } from 'next/navigation'

export default function DashboardDockerTerminalPage() {
  redirect('/dashboard/docker/shell')
}
