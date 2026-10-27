import { FieldError } from '@deployer/ui/components/shadcn/field'

/** The message to show under a required text field, or `null` while it is fine or untouched. */
export function requiredMessage(touched: boolean, value: unknown, message: string): string | null {
  if (!touched) return null
  if (typeof value === 'string' && value.trim() === '') return message
  if (value === undefined || value === null) return message
  return null
}

/** Inline "required" error shown next to the field once the operator has left it empty. */
export function RequiredError({ touched, value, message }: { touched: boolean; value: unknown; message: string }) {
  const text = requiredMessage(touched, value, message)
  return text ? <FieldError>{text}</FieldError> : null
}
