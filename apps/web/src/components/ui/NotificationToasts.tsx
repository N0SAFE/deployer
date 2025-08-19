'use client'

import { useNotifications, useUIStore } from '@/state/uiStore'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Button } from '@repo/ui/components/shadcn/button'
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@repo/ui/lib/utils'

const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

const colorMap = {
  success: 'border-green-200 text-green-800 dark:border-green-800 dark:text-green-200',
  error: 'border-red-200 text-red-800 dark:border-red-800 dark:text-red-200',
  warning: 'border-yellow-200 text-yellow-800 dark:border-yellow-800 dark:text-yellow-200',
  info: 'border-blue-200 text-blue-800 dark:border-blue-800 dark:text-blue-200',
}

export function NotificationToasts() {
  const notifications = useNotifications()
  const removeNotification = useUIStore((state) => state.removeNotification)

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-full max-w-sm">
      {notifications.map((notification) => {
        const Icon = iconMap[notification.type]
        
        return (
          <Alert
            key={notification.id}
            className={cn(
              'transition-all animate-in slide-in-from-right-full',
              colorMap[notification.type]
            )}
          >
            <Icon className="h-4 w-4" />
            <div className="flex-1">
              <AlertTitle className="flex items-center justify-between">
                {notification.title}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto p-1 hover:bg-transparent"
                  onClick={() => removeNotification(notification.id)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </AlertTitle>
              {notification.message && (
                <AlertDescription className="mt-1">
                  {notification.message}
                </AlertDescription>
              )}
            </div>
          </Alert>
        )
      })}
    </div>
  )
}