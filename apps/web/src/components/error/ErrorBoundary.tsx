/**
 * @fileoverview Base Error Boundary Component
 * 
 * React class component that catches JavaScript errors anywhere in the component tree.
 * This is the foundation for more specialized error boundaries.
 * 
 * @see https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
 */
'use client'

import React, { Component, ReactNode } from 'react'
import { logger } from '@repo/logger'
import { DefaultErrorFallback } from './DefaultErrorFallback'

interface ErrorBoundaryProps {
  /** Child components to render */
  children: ReactNode
  /** Fallback UI to show when error occurs */
  fallback?: (error: Error, reset: () => void) => ReactNode
  /** Callback when error is caught */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
  /** Optional identifier for logging context */
  context?: string
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

/**
 * Base error boundary that catches React errors
 * 
 * @example Basic usage
 * ```tsx
 * <ErrorBoundary fallback={(error, reset) => <div>Error: {error.message}</div>}>
 *   <MyComponent />
 * </ErrorBoundary>
 * ```
 * 
 * @example With custom error handler
 * ```tsx
 * <ErrorBoundary
 *   context="UserProfile"
 *   onError={(error, info) => trackError('profile', error)}
 *   fallback={(error, reset) => <ErrorFallback error={error} onReset={reset} />}
 * >
 *   <UserProfile />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const { onError, context } = this.props
    
    // Log error with context
    const logContext = context ? { boundary: context } : {}
    logger.error(error, {
      ...logContext,
      componentStack: errorInfo.componentStack,
      errorMessage: error.message,
      errorName: error.name,
    })

    // Call custom error handler if provided
    onError?.(error, errorInfo)
  }

  resetError = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    const { hasError, error } = this.state
    const { children, fallback } = this.props

    if (hasError && error) {
      // Render custom fallback if provided
      if (fallback) {
        return fallback(error, this.resetError)
      }

      // No fallback given — reuse the shared one rather than keeping a second,
      // hand-rolled copy of the same markup here.
      return <DefaultErrorFallback error={error} onReset={this.resetError} />
    }

    return children
  }
}
