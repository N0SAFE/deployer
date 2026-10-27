import { Compass, LayoutDashboard } from 'lucide-react'
import { Button } from '@deployer/ui/components/shadcn/button'
import { AuthDashboard, Home } from '@/routes'

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <Compass className="size-7 text-muted-foreground" aria-hidden />
      </div>
      <h1 className="mt-5 text-xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        This address does not exist, or it moved. Check the link, or go back to a page you know.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button asChild size="sm">
          <AuthDashboard.Link>
            <LayoutDashboard className="size-3.5" />
            Back to dashboard
          </AuthDashboard.Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Home.Link>Home</Home.Link>
        </Button>
      </div>
    </div>
  )
}
