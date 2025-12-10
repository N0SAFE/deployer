"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

type Cleanup = () => void
export type WebSocketStatus = "idle" | "connecting" | "connected" | "error" | "mock"

export function useWebSocket() {
  const socketRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<WebSocketStatus>("idle")
  const useMocks = useMemo(() => process.env.NEXT_PUBLIC_USE_MOCKS === "true", [])

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close()
      socketRef.current = null
    }
    setStatus("idle")
  }, [])

  const connect = useCallback((): Cleanup | undefined => {
    if (useMocks) {
      setStatus("mock")
      return
    }

    if (typeof window === "undefined") return
    if (socketRef.current) return

    const defaultUrl = window.location.origin.replace(/^http/, "ws") + "/deployments"
    const url = process.env.NEXT_PUBLIC_WS_URL ?? defaultUrl

    try {
      setStatus("connecting")
      const socket = new WebSocket(url)
      socketRef.current = socket

      socket.onopen = () => {
        setStatus("connected")
      }
      socket.onerror = () => {
        setStatus("error")
      }
      socket.onclose = () => {
        socketRef.current = null
        setStatus("idle")
      }

      return () => {
        socket.close()
        socketRef.current = null
        setStatus("idle")
      }
    } catch (error) {
      console.error("WebSocket connection failed", error)
      setStatus("error")
      return
    }
  }, [useMocks])

  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return {
    status,
    isConnected: status === "connected" || status === "mock",
    connect,
    disconnect,
  }
}
