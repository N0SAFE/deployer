'use client'

import React from 'react'

export default function Validate({
    children,
}: React.PropsWithChildren<object>) {
    // Better Auth handles session validation automatically
    // No need for manual Zustand sync since we're using Better Auth's built-in session management
    return <>{children}</>
}
