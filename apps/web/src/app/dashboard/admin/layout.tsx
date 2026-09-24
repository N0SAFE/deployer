import { FeatureErrorBoundary } from '@/components/error'
import type { ReactNode } from 'react'
import type { Metadata } from 'next'

/**
 * Admin Panel Layout with Error Boundaries
 * 
 * Wraps admin-specific routes with FeatureErrorBoundary to provide
 * granular error handling for admin operations. Admin errors are logged
 * with feature context for better debugging.
 * 
 * Admin routes:
 * - /dashboard/admin/users - User management
 * - /dashboard/admin/domains - Project domain verification
 * - /dashboard/admin/providers - Provider configuration
 * - /dashboard/admin/system - System settings
 */
// Metadata lives in the layout: the admin pages are client components, and
// `metadata` cannot be exported from a `'use client'` file.
export const metadata: Metadata = {
  title: 'Administration',
  description: 'Users, providers, domains and system settings',
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <FeatureErrorBoundary
      feature="AdminPanel"
      metadata={{ section: 'admin' }}
    >
      {/* Admin-specific header could go here if needed */}
      <div className="space-y-6">
        {children}
      </div>
    </FeatureErrorBoundary>
  )
}
