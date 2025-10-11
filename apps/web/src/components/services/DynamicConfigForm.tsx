/**
 * Dynamic Configuration Form Component
 * 
 * Renders a dynamic form based on a configuration schema from the registry.
 * Supports various field types: text, number, boolean, select, textarea, password, url, json, array
 */

'use client';

import { useEffect } from 'react';
import { UseFormReturn } from 'react-hook-form';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@repo/ui/components/shadcn/form';
import { Input } from '@repo/ui/components/shadcn/input';
import { Textarea } from '@repo/ui/components/shadcn/textarea';
import { Checkbox } from '@repo/ui/components/shadcn/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card';

// Type definitions matching the backend schema
interface ConfigSchemaField {
  key: string;
  label: string;
  description?: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'textarea' | 'password' | 'url' | 'json' | 'array';
  required: boolean;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string | number | boolean }>;
  placeholder?: string;
  group?: string;
  conditional?: {
    field: string;
    value: unknown;
    operator?: 'equals' | 'notEquals' | 'in' | 'notIn';
  };
  ui?: {
    order?: number;
    fullWidth?: boolean;
    inline?: boolean;
    icon?: string;
  };
}

interface ConfigSchema {
  id: string;
  version: string;
  title: string;
  description: string;
  fields: ConfigSchemaField[];
}

interface DynamicConfigFormProps {
  schema: ConfigSchema;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
  fieldPrefix?: string;
}

/**
 * Evaluate conditional visibility
 */
function isFieldVisible(
  field: ConfigSchemaField,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formValues: any,
  fieldPrefix?: string
): boolean {
  if (!field.conditional) return true;

  const watchField = fieldPrefix 
    ? `${fieldPrefix}.${field.conditional.field}`
    : field.conditional.field;
  
  const watchValue = formValues[watchField] ?? formValues[field.conditional.field];
  const expectedValue = field.conditional.value;
  const operator = field.conditional.operator || 'equals';

  switch (operator) {
    case 'equals':
      return watchValue === expectedValue;
    case 'notEquals':
      return watchValue !== expectedValue;
    case 'in':
      return Array.isArray(expectedValue) && expectedValue.includes(watchValue);
    case 'notIn':
      return Array.isArray(expectedValue) && !expectedValue.includes(watchValue);
    default:
      return true;
  }
}

/**
 * Render a single form field based on its type
 */
function RenderFormField({
  field,
  form,
  fieldPrefix,
}: {
  field: ConfigSchemaField;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
  fieldPrefix?: string;
}) {
  const fieldName = fieldPrefix ? `${fieldPrefix}.${field.key}` : field.key;
  const formValues = form.watch();
  
  // Check conditional visibility
  if (!isFieldVisible(field, formValues, fieldPrefix)) {
    return null;
  }

  // Set default value if not set
  useEffect(() => {
    if (field.defaultValue !== undefined && form.getValues(fieldName) === undefined) {
      form.setValue(fieldName, field.defaultValue);
    }
  }, [field.defaultValue, fieldName, form]);

  switch (field.type) {
    case 'text':
    case 'password':
    case 'url':
      return (
        <FormField
          key={fieldName}
          control={form.control}
          name={fieldName}
          render={({ field: formField }) => (
            <FormItem className={field.ui?.fullWidth ? 'col-span-2' : ''}>
              <FormLabel>
                {field.label}
                {field.required && <span className="text-destructive ml-1">*</span>}
              </FormLabel>
              <FormControl>
                <Input
                  type={field.type}
                  placeholder={field.placeholder}
                  {...formField}
                />
              </FormControl>
              {field.description && (
                <FormDescription>{field.description}</FormDescription>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      );

    case 'number':
      return (
        <FormField
          key={fieldName}
          control={form.control}
          name={fieldName}
          render={({ field: formField }) => (
            <FormItem className={field.ui?.fullWidth ? 'col-span-2' : ''}>
              <FormLabel>
                {field.label}
                {field.required && <span className="text-destructive ml-1">*</span>}
              </FormLabel>
              <FormControl>
                <Input
                  type="number"
                  placeholder={field.placeholder}
                  {...formField}
                  onChange={(e) => formField.onChange(Number(e.target.value))}
                />
              </FormControl>
              {field.description && (
                <FormDescription>{field.description}</FormDescription>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      );

    case 'textarea':
      return (
        <FormField
          key={fieldName}
          control={form.control}
          name={fieldName}
          render={({ field: formField }) => (
            <FormItem className={field.ui?.fullWidth ? 'col-span-2' : ''}>
              <FormLabel>
                {field.label}
                {field.required && <span className="text-destructive ml-1">*</span>}
              </FormLabel>
              <FormControl>
                <Textarea
                  placeholder={field.placeholder}
                  rows={4}
                  {...formField}
                />
              </FormControl>
              {field.description && (
                <FormDescription>{field.description}</FormDescription>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      );

    case 'boolean':
      return (
        <FormField
          key={fieldName}
          control={form.control}
          name={fieldName}
          render={({ field: formField }) => (
            <FormItem className={`flex items-center space-x-2 ${field.ui?.fullWidth ? 'col-span-2' : ''}`}>
              <FormControl>
                <Checkbox
                  checked={formField.value}
                  onCheckedChange={formField.onChange}
                />
              </FormControl>
              <div className="space-y-0">
                <FormLabel className="font-normal">
                  {field.label}
                  {field.required && <span className="text-destructive ml-1">*</span>}
                </FormLabel>
                {field.description && (
                  <FormDescription>{field.description}</FormDescription>
                )}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      );

    case 'select':
      return (
        <FormField
          key={fieldName}
          control={form.control}
          name={fieldName}
          render={({ field: formField }) => (
            <FormItem className={field.ui?.fullWidth ? 'col-span-2' : ''}>
              <FormLabel>
                {field.label}
                {field.required && <span className="text-destructive ml-1">*</span>}
              </FormLabel>
              <Select
                onValueChange={formField.onChange}
                value={formField.value}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={field.placeholder || `Select ${field.label.toLowerCase()}`} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {field.options?.map((option) => (
                    <SelectItem 
                      key={String(option.value)} 
                      value={String(option.value)}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {field.description && (
                <FormDescription>{field.description}</FormDescription>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      );

    case 'json':
      return (
        <FormField
          key={fieldName}
          control={form.control}
          name={fieldName}
          render={({ field: formField }) => (
            <FormItem className={field.ui?.fullWidth ? 'col-span-2' : ''}>
              <FormLabel>
                {field.label}
                {field.required && <span className="text-destructive ml-1">*</span>}
              </FormLabel>
              <FormControl>
                <Textarea
                  placeholder={field.placeholder || '{\n  "key": "value"\n}'}
                  rows={6}
                  className="font-mono text-sm"
                  {...formField}
                  value={typeof formField.value === 'string' ? formField.value : JSON.stringify(formField.value, null, 2)}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value);
                      formField.onChange(parsed);
                    } catch {
                      formField.onChange(e.target.value);
                    }
                  }}
                />
              </FormControl>
              {field.description && (
                <FormDescription>{field.description}</FormDescription>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      );

    default:
      return null;
  }
}

/**
 * Dynamic Configuration Form Component
 */
export default function DynamicConfigForm({
  schema,
  form,
  fieldPrefix,
}: DynamicConfigFormProps) {
  // Group fields by group property
  const groupedFields = schema.fields.reduce((acc, field) => {
    const group = field.group || 'default';
    if (!acc[group]) acc[group] = [];
    acc[group].push(field);
    return acc;
  }, {} as Record<string, ConfigSchemaField[]>);

  // Sort fields by ui.order if available
  Object.values(groupedFields).forEach((fields) => {
    fields.sort((a, b) => (a.ui?.order ?? 999) - (b.ui?.order ?? 999));
  });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">{schema.title}</h3>
        <p className="text-sm text-muted-foreground">{schema.description}</p>
      </div>

      {Object.entries(groupedFields).map(([group, fields]) => {
        if (group === 'default') {
          return (
            <div key={group} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {fields.map((field) => (
                <RenderFormField key={field.key} field={field} form={form} fieldPrefix={fieldPrefix} />
              ))}
            </div>
          );
        }

        return (
          <Card key={group}>
            <CardHeader>
              <CardTitle className="text-base capitalize">{group}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {fields.map((field) => (
                  <RenderFormField key={field.key} field={field} form={form} fieldPrefix={fieldPrefix} />
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
