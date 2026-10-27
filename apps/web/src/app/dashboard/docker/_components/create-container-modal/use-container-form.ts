import { useCallback, useMemo, useState } from 'react'
import { useOnDepsChange } from '../../_hooks/use-on-deps-change'
import {
  CONFIG_PRESETS, createInitialState, emptyRow,
  type ContainerFormState, type ListKey,
} from './container-form.model'
import { validateForm, type FormErrors } from './container-form.validation'

export interface FieldProps {
  id: string
  'aria-invalid': true | undefined
  'aria-describedby': string | undefined
  onBlur: () => void
}

/** DOM id of a field's error message, referenced by `aria-describedby`. */
export function fieldErrorId(name: string): string {
  return `ccm-${name.replace(/\./g, '-')}-error`
}

export function fieldId(name: string): string {
  return `ccm-${name.replace(/\./g, '-')}`
}

/**
 * Form state + validation for the create-container dialog. Errors are computed
 * for the whole form, but only *shown* for fields the operator has left, so a
 * half-typed row is not shouted at. The two required fields (name, image) are
 * shown as soon as the Container step is open (`attempted`).
 */
export function useContainerForm(open: boolean, prefilledImage?: string) {
  const [state, setState] = useState<ContainerFormState>(() => createInitialState(prefilledImage))
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  const [attempted, setAttempted] = useState(false)

  useOnDepsChange([open, prefilledImage], () => {
    if (!open) return
    setState(createInitialState(prefilledImage))
    setTouched(new Set())
    setAttempted(false)
  }, false)

  const errors: FormErrors = useMemo(() => validateForm(state), [state])
  const errorCount = Object.keys(errors).length

  const setField = useCallback(<K extends keyof ContainerFormState>(key: K, value: ContainerFormState[K]): void => {
    setState((previous) => ({ ...previous, [key]: value }))
  }, [])

  const updateRow = useCallback(<K extends ListKey>(key: K, index: number, patch: Partial<ContainerFormState[K][number]>): void => {
    setState((previous) => {
      const rows: ContainerFormState[K][number][] = previous[key]
      return { ...previous, [key]: rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) }
    })
  }, [])

  const addRow = useCallback(<K extends ListKey>(key: K): void => {
    setState((previous) => {
      const rows: ContainerFormState[K][number][] = previous[key]
      return { ...previous, [key]: [...rows, emptyRow(key)] }
    })
  }, [])

  const removeRow = useCallback(<K extends ListKey>(key: K, index: number): void => {
    setState((previous) => {
      const rows: ContainerFormState[K][number][] = previous[key]
      return { ...previous, [key]: rows.filter((_, i) => i !== index) }
    })
  }, [])

  const applyPreset = useCallback((presetId: string): void => {
    const preset = CONFIG_PRESETS.find((item) => item.id === presetId)
    setState((previous) => ({ ...previous, ...preset?.patch, selectedConfigSetId: presetId }))
  }, [])

  const touch = useCallback((name: string): void => {
    setTouched((previous) => (previous.has(name) ? previous : new Set(previous).add(name)))
  }, [])

  const errorFor = useCallback((name: string): string | undefined => {
    const message = errors[name]
    const alwaysShown = attempted && (name === 'name' || name === 'image')
    return message && (alwaysShown || touched.has(name)) ? message : undefined
  }, [attempted, errors, touched])

  const fieldProps = useCallback((name: string): FieldProps => ({
    id: fieldId(name),
    'aria-invalid': errorFor(name) ? true : undefined,
    'aria-describedby': errorFor(name) ? fieldErrorId(name) : undefined,
    onBlur: () => { touch(name) },
  }), [errorFor, touch])

  return {
    state, setField, updateRow, addRow, removeRow, applyPreset,
    errors, errorCount, errorFor, fieldProps, attempted, markAttempted: () => { setAttempted(true) },
  }
}

export type ContainerForm = ReturnType<typeof useContainerForm>
