/**
 * App Loading Screen
 *
 * A beautiful, branded loading screen for the entire application.
 * Used as the default loading state during navigation and initial page loads.
 *
 * Features:
 * - Animated logo with pulse effect
 * - Smooth progress indicator
 * - Professional branding
 * - Responsive design
 * - Dark/light mode compatible
 *
 * IMPORTANT: This is rendered in Suspense fallbacks, so it MUST NOT:
 * - Use any React hooks
 * - Import 'use client' components that use hooks
 *
 * Pure server component with CSS animations only.
 */

import { cn } from '@deployer/ui/lib/utils'

// ============================================================================
// Logo Component
// ============================================================================

/**
 * Animated logo mark with gradient and glow effects
 */
function LogoMark({ className }: { className?: string }) {
    return (
        <div className={cn('relative', className)}>
            {/* Glow effect behind logo */}
            <div className="bg-primary/20 absolute inset-0 animate-pulse rounded-2xl blur-xl" />

            {/* Main logo container */}
            <div className="from-primary to-primary/80 shadow-primary/25 relative flex h-20 w-20 items-center justify-center rounded-2xl bg-linear-to-br shadow-2xl">
                {/* Lightning bolt icon */}
                <svg
                    className="text-primary-foreground h-10 w-10"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                </svg>
            </div>
        </div>
    )
}

// ============================================================================
// Loading Indicators
// ============================================================================

/**
 * Animated dots loading indicator
 */
function LoadingDots() {
    return (
        <div className="flex items-center gap-1.5">
            <span className="sr-only">Loading</span>
            {Array.from({ length: 3 }, (_, i) => (
                <div
                    key={i}
                    className="bg-primary h-2 w-2 rounded-full"
                    style={{
                        animation: 'bounce 1.4s ease-in-out infinite',
                        animationDelay: `${String(i * 0.16)}s`,
                    }}
                />
            ))}
        </div>
    )
}

/**
 * Smooth progress bar with shimmer effect
 */
function ProgressBar() {
    return (
        <div className="bg-muted h-1 w-48 overflow-hidden rounded-full">
            <div
                className="from-primary via-primary/60 to-primary h-full w-full rounded-full bg-linear-to-r"
                style={{
                    animation: 'progress 2s ease-in-out infinite',
                }}
            />
        </div>
    )
}

/**
 * Spinning ring loader
 */
function SpinnerRing({ className }: { className?: string }) {
    return (
        <div className={cn('relative', className)}>
            {/* Background ring */}
            <div className="border-muted h-12 w-12 rounded-full border-4" />
            {/* Spinning segment */}
            <div
                className="border-t-primary absolute inset-0 h-12 w-12 rounded-full border-4 border-transparent"
                style={{ animation: 'spin 1s linear infinite' }}
            />
        </div>
    )
}

// ============================================================================
// Main Loading Screen Variants
// ============================================================================

/**
 * Full-page branded loading screen with logo
 * Use this as the main app loading state
 */
export function AppLoadingScreen() {
    return (
        <div className="bg-background fixed inset-0 z-50 flex flex-col items-center justify-center">
            {/* Subtle background pattern */}
            <div className="from-primary/5 via-background to-background absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--tw-gradient-stops))]" />

            {/* Content */}
            <div className="relative flex flex-col items-center gap-8">
                {/* Logo */}
                <LogoMark />

                {/* Brand name */}
                <div className="flex flex-col items-center gap-2">
                    <h1 className="text-2xl font-bold tracking-tight">
                        Your App
                    </h1>
                    <p className="text-muted-foreground text-sm">
                        Loading your experience...
                    </p>
                </div>

                {/* Progress indicator */}
                <ProgressBar />
            </div>

            {/* CSS Animations */}
            <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-8px); }
        }
        @keyframes progress {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(0); }
          100% { transform: translateX(100%); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
        </div>
    )
}

/**
 * Minimal loading screen - just logo and spinner
 * Good for faster perceived loading
 */
export function AppLoadingMinimal() {
    return (
        <div className="bg-background fixed inset-0 z-50 flex items-center justify-center">
            <div className="flex flex-col items-center gap-6">
                <LogoMark />
                <SpinnerRing />
            </div>

            <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
        </div>
    )
}

/**
 * Elegant loading screen with dots animation
 */
export function AppLoadingElegant() {
    return (
        <div className="bg-background fixed inset-0 z-50 flex flex-col items-center justify-center">
            {/* Gradient overlay */}
            <div className="from-primary/5 absolute inset-0 bg-linear-to-b to-transparent" />

            <div className="relative flex flex-col items-center gap-8">
                {/* Animated logo */}
                <div className="relative">
                    {/* Outer ring */}
                    <div
                        className="border-primary/20 absolute -inset-4 rounded-3xl border-2"
                        style={{ animation: 'pulse 2s ease-in-out infinite' }}
                    />
                    <LogoMark />
                </div>

                {/* Loading text with dots */}
                <div className="text-muted-foreground flex items-center gap-3">
                    <span className="text-sm font-medium">Loading</span>
                    <LoadingDots />
                </div>
            </div>

            <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.05); }
        }
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
        }
      `}</style>
        </div>
    )
}

/**
 * Centered loading card - for inline loading states
 */
export function AppLoadingCard() {
    return (
        <div className="flex min-h-screen items-center justify-center p-4">
            <div className="bg-card flex flex-col items-center gap-6 rounded-2xl border p-8 shadow-lg">
                <div className="bg-primary/10 flex h-16 w-16 items-center justify-center rounded-xl">
                    <svg
                        className="text-primary h-8 w-8"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                        />
                    </svg>
                </div>

                <div className="flex flex-col items-center gap-2 text-center">
                    <h2 className="font-semibold">Loading</h2>
                    <p className="text-muted-foreground text-sm">
                        Please wait a moment...
                    </p>
                </div>

                <SpinnerRing />
            </div>

            <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
        </div>
    )
}

/**
 * Simple centered spinner - for quick loading states
 */
export function AppLoadingSpinner() {
    return (
        <div className="flex min-h-screen items-center justify-center">
            <div className="flex flex-col items-center gap-4">
                <SpinnerRing />
                <p className="text-muted-foreground text-sm">Loading...</p>
            </div>

            <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
        </div>
    )
}
