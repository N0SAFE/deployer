'use client'

import { useCallback, useMemo, useState } from 'react'
import type { z } from 'zod/v4'
import { fieldErrors } from './form-errors'

/**
 * Minimal controlled form: zod validates on every change, but a message only shows
 * once the field was left (blurred) or a submit was attempted — so nobody is told
 * "required" before they typed anything.
 */
export function useSimpleForm<K extends string>(schema: z.ZodType, initial: Record<K, string>) {
  const [values, setValues] = useState<Record<K, string>>(initial)
  const [touched, setTouched] = useState<Partial<Record<K, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)

  const all = useMemo(() => fieldErrors(schema, values), [schema, values])

  const errorFor = useCallback((key: K): string | undefined => (submitted || touched[key] ? all[key] : undefined), [all, submitted, touched])
  const setValue = useCallback((key: K, value: string) => { setValues((v) => ({ ...v, [key]: value })); }, [])
  const touch = useCallback((key: K) => { setTouched((t) => ({ ...t, [key]: true })); }, [])
  const reset = useCallback(() => {
    setValues(initial)
    setTouched({})
    setSubmitted(false)
    // `initial` is a constant literal at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Marks every field as visited; true when the values are valid. */
  const validate = useCallback((): boolean => {
    setSubmitted(true)
    return Object.keys(all).length === 0
  }, [all])

  return { values, setValue, touch, errorFor, validate, reset }
}
