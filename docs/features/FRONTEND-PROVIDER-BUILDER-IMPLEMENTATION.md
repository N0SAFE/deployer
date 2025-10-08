# Frontend Implementation: Provider-Builder Registry Pattern

**Date**: January 2025  
**Status**: ✅ COMPLETED

## Overview

This document describes the frontend implementation of the provider-builder registry pattern. The frontend dynamically fetches providers and builders from the registry API and renders configuration forms based on schemas.

## Architecture

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                   User Opens Create Service Dialog           │
└────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│          Fetch Providers and Builders from Registry          │
│                                                               │
│  useProviders() → GET /api/providers                         │
│  useBuilders() → GET /api/builders                           │
│                                                               │
│  Returns: [{ id, name, description, category, ... }]         │
└────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   User Selects Provider                      │
│                                                               │
│  onChange → setSelectedProvider(providerId)                  │
└────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│            Fetch Compatible Builders for Provider            │
│                                                               │
│  useCompatibleBuilders(providerId)                           │
│    → GET /api/providers/:providerId/builders                 │
│                                                               │
│  Returns: [{ id, name, description, category, ... }]         │
│  (Filtered to only compatible builders)                      │
└────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   User Selects Builder                       │
│                                                               │
│  onChange → setSelectedBuilder(builderId)                    │
└────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Fetch Configuration Schemas                     │
│                                                               │
│  useProviderSchema(providerId)                               │
│    → GET /api/providers/:providerId/schema                   │
│                                                               │
│  useBuilderSchema(builderId)                                 │
│    → GET /api/builders/:builderId/schema                     │
│                                                               │
│  Returns: ConfigSchema { fields: [...] }                     │
└────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Render Dynamic Configuration Forms              │
│                                                               │
│  DynamicConfigForm renders fields based on schema:           │
│    - text, number, boolean, select, textarea, etc.          │
│    - Conditional visibility                                  │
│    - Field grouping                                          │
│    - Validation                                              │
└────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                User Fills Out Configuration                  │
│                                                               │
│  Form values stored in:                                      │
│    - providerConfig: { ...dynamic fields }                  │
│    - builderConfig: { ...dynamic fields }                   │
└────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   User Submits Form                          │
│                                                               │
│  POST /api/services with:                                    │
│    {                                                         │
│      name, type, port, healthCheckPath,                     │
│      provider: "github",                                     │
│      builder: "dockerfile",                                  │
│      providerConfig: { repositoryUrl, branch, ... },        │
│      builderConfig: { dockerfilePath, ... }                 │
│    }                                                         │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. useProviderBuilder Hook

**Location**: `/apps/web/src/hooks/useProviderBuilder.ts`

**Purpose**: Provides React Query hooks for interacting with the provider-builder registry API.

**Hooks**:
```typescript
useProviders() // Fetch all providers
useBuilders() // Fetch all builders
useCompatibleBuilders(providerId) // Fetch compatible builders for a provider
useCompatibleProviders(builderId) // Fetch compatible providers for a builder
useProviderSchema(providerId) // Fetch provider configuration schema
useBuilderSchema(builderId) // Fetch builder configuration schema
```

**Usage Example**:
```typescript
const { data: providersData, isLoading } = useProviders();
// providersData = { providers: [...], total: 2 }

const { data: compatibleBuilders } = useCompatibleBuilders('github');
// compatibleBuilders = { builders: [...], total: 4 }

const { data: schema } = useProviderSchema('github');
// schema = { id, version, title, description, fields: [...] }
```

### 2. DynamicConfigForm Component

**Location**: `/apps/web/src/components/services/DynamicConfigForm.tsx`

**Purpose**: Renders a dynamic form based on a configuration schema from the registry.

**Features**:
- ✅ Supports multiple field types: text, number, boolean, select, textarea, password, url, json, array
- ✅ Conditional field visibility based on other field values
- ✅ Field grouping and organization
- ✅ Automatic form validation
- ✅ Default values
- ✅ Placeholder text and descriptions

**Field Type Examples**:

```typescript
// Text field
{
  key: "repositoryUrl",
  label: "Repository URL",
  type: "text",
  required: true,
  placeholder: "https://github.com/user/repo"
}

// Select field
{
  key: "branch",
  label: "Branch",
  type: "select",
  required: true,
  options: [
    { label: "main", value: "main" },
    { label: "develop", value: "develop" }
  ]
}

// Conditional field (only shows if another field has specific value)
{
  key: "privateKey",
  label: "Private Key",
  type: "password",
  required: false,
  conditional: {
    field: "authentication",
    value: "ssh",
    operator: "equals"
  }
}
```

**Usage**:
```tsx
<DynamicConfigForm 
  schema={providerSchema} 
  form={form} 
  fieldPrefix="providerConfig" 
/>
```

### 3. CreateServiceDialogRegistry Component

**Location**: `/apps/web/src/components/services/CreateServiceDialogRegistry.tsx`

**Purpose**: Service creation dialog using the registry pattern.

**Features**:
- ✅ Dynamic provider selection from registry
- ✅ Filtered builder selection based on provider compatibility
- ✅ Real-time schema fetching
- ✅ Dynamic form rendering
- ✅ Provider/builder metadata display with badges
- ✅ Loading states and error handling

**State Flow**:
```typescript
1. User selects provider → setSelectedProvider('github')
2. Compatible builders fetched → useCompatibleBuilders('github')
3. User selects builder → setSelectedBuilder('dockerfile')
4. Schemas fetched → useProviderSchema + useBuilderSchema
5. Dynamic forms rendered → DynamicConfigForm components
6. User fills forms → form.watch('providerConfig'), form.watch('builderConfig')
7. Submit → POST /api/services with full configuration
```

**Component Structure**:
```tsx
<CreateServiceDialogRegistry>
  <Form>
    {/* Basic Configuration */}
    <Card>
      <Input name="name" />
      <Select name="type" />
      <Input name="port" />
      <Input name="healthCheckPath" />
    </Card>

    {/* Provider Selection */}
    <Card>
      <Select name="provider">
        {providersData.providers.map(...)}
      </Select>
      {/* Provider metadata display */}
    </Card>

    {/* Builder Selection (filtered) */}
    <Card>
      <Select name="builder">
        {compatibleBuilders.builders.map(...)}
      </Select>
      {/* Builder metadata display */}
    </Card>

    {/* Provider Configuration (dynamic) */}
    {selectedProvider && providerSchema && (
      <Card>
        <DynamicConfigForm 
          schema={providerSchema} 
          fieldPrefix="providerConfig" 
        />
      </Card>
    )}

    {/* Builder Configuration (dynamic) */}
    {selectedBuilder && builderSchema && (
      <Card>
        <DynamicConfigForm 
          schema={builderSchema} 
          fieldPrefix="builderConfig" 
        />
      </Card>
    )}

    <Button type="submit">Create Service</Button>
  </Form>
</CreateServiceDialogRegistry>
```

## Data Flow

### 1. Provider Selection

```typescript
// User selects GitHub provider
onChange={(value) => {
  form.setValue('provider', 'github');
  setSelectedProvider('github');
}}

// Effect triggers: Fetch compatible builders
useEffect(() => {
  if (selectedProvider) {
    // GET /api/providers/github/builders
    const { data } = useCompatibleBuilders('github');
    // Returns: { builders: [dockerfile, buildpack, nixpack, static], total: 4 }
  }
}, [selectedProvider]);
```

### 2. Schema Fetching

```typescript
// Provider schema
const { data: providerSchema } = useProviderSchema('github');
// GET /api/providers/github/schema
// Returns:
{
  id: "github",
  version: "1.0.0",
  title: "GitHub Configuration",
  description: "Configure GitHub repository settings",
  fields: [
    {
      key: "repositoryUrl",
      label: "Repository URL",
      type: "text",
      required: true,
      placeholder: "https://github.com/user/repo"
    },
    {
      key: "branch",
      label: "Branch",
      type: "text",
      required: true,
      defaultValue: "main"
    },
    {
      key: "accessToken",
      label: "Access Token",
      type: "password",
      required: false,
      description: "Personal access token for private repos"
    }
  ]
}
```

### 3. Form Submission

```typescript
const onSubmit = async (data: ServiceFormData) => {
  await createService.mutateAsync({
    projectId: "project-123",
    name: "my-app",
    type: "web",
    provider: "github", // Selected from registry
    builder: "dockerfile", // Selected from compatible builders
    port: 3000,
    healthCheckPath: "/health",
    
    // Dynamic configuration from schemas
    providerConfig: {
      repositoryUrl: "https://github.com/user/repo",
      branch: "main",
      accessToken: "ghp_xxxxxxxxxxxx"
    },
    builderConfig: {
      dockerfilePath: "Dockerfile",
      buildContext: ".",
      buildArgs: { NODE_ENV: "production" }
    }
  });
};

// POST /api/services
// Deployment service will:
// 1. Get provider instance: providerRegistry.getProvider('github')
// 2. Get builder instance: builderRegistry.getBuilder('dockerfile')
// 3. Fetch source: provider.fetchSource(providerConfig, trigger)
// 4. Build and deploy: builder.deploy(builderConfig)
```

## Benefits

### 1. Dynamic Configuration ✅
- No hardcoded provider/builder lists
- Forms generated from API schemas
- Easy to add new providers/builders (no frontend changes)

### 2. Type Safety ✅
- TypeScript interfaces for all data structures
- Zod validation for form schemas
- React Hook Form integration

### 3. User Experience ✅
- Real-time feedback (provider metadata, builder filtering)
- Progressive disclosure (schemas loaded on-demand)
- Clear visual hierarchy with cards and badges
- Loading states and error handling

### 4. Maintainability ✅
- Separation of concerns (hooks, components, forms)
- Reusable DynamicConfigForm component
- Single source of truth (backend registry)

### 5. Extensibility ✅
- Support for new field types (just add to DynamicConfigForm)
- Conditional field logic
- Field grouping and organization
- Custom validators

## Example: Adding a New Provider

**Backend** (already implemented):
```typescript
// 1. Create provider service implementing IDeploymentProvider + IProvider
// 2. Register in ProviderRegistryInitializer
// 3. Define getConfigSchema() with fields
```

**Frontend** (automatic):
```typescript
// ✅ Provider appears in dropdown automatically
// ✅ Configuration form rendered from schema automatically
// ✅ Validation handled automatically
// ✅ Submission includes provider config automatically
```

**No frontend code changes needed!**

## Testing Checklist

### Unit Tests
- [ ] useProviderBuilder hooks
  - [ ] Test provider fetching
  - [ ] Test builder fetching
  - [ ] Test compatible builders filtering
  - [ ] Test schema fetching

- [ ] DynamicConfigForm component
  - [ ] Test field rendering for each type
  - [ ] Test conditional visibility
  - [ ] Test form validation
  - [ ] Test default values

- [ ] CreateServiceDialogRegistry component
  - [ ] Test provider selection flow
  - [ ] Test builder filtering
  - [ ] Test schema fetching
  - [ ] Test form submission

### Integration Tests
- [ ] Full service creation flow
  - [ ] Select provider → builders filtered
  - [ ] Select builder → schemas loaded
  - [ ] Fill forms → submit successful
  - [ ] Service created with correct config

### E2E Tests
- [ ] User can create service with GitHub + Dockerfile
- [ ] User can create service with Static + Static
- [ ] Conditional fields show/hide correctly
- [ ] Validation errors display properly
- [ ] Form resets after successful submission

## Migration from Old Dialog

### Old Approach (Hardcoded)
```tsx
// ❌ Static lists
const SERVICE_PROVIDERS = [
  { value: 'github', label: 'GitHub', ... },
  { value: 'gitlab', label: 'GitLab', ... },
];

// ❌ Hardcoded forms
{provider === 'github' && (
  <Input name="repositoryUrl" />
  <Input name="branch" />
)}
```

### New Approach (Registry-Based)
```tsx
// ✅ Dynamic from API
const { data } = useProviders();
{data.providers.map(p => <SelectItem>{p.name}</SelectItem>)}

// ✅ Schema-driven forms
{providerSchema && (
  <DynamicConfigForm schema={providerSchema} />
)}
```

### Migration Steps
1. ✅ Import CreateServiceDialogRegistry
2. ✅ Replace CreateServiceDialog with CreateServiceDialogRegistry
3. ✅ Test provider/builder selection
4. ✅ Test dynamic form rendering
5. ✅ Test service creation

## Future Enhancements

### 1. Advanced Field Types
- File upload field
- Multi-select with chips
- Code editor (Monaco) for JSON/YAML
- Date/time picker

### 2. Schema Enhancements
- Client-side validation rules (regex, min/max, custom)
- Field dependencies (enable/disable based on other fields)
- Dynamic options (fetch from API)
- Field templates (reusable field groups)

### 3. User Experience
- Schema preview before selection
- Configuration templates (pre-filled forms)
- Import/export configuration
- Configuration history

### 4. Developer Experience
- Storybook stories for DynamicConfigForm
- Visual schema builder
- Configuration debugger
- Mock provider/builder for testing

## Conclusion

The frontend successfully implements the provider-builder registry pattern with:

- ✅ **Dynamic Discovery**: Providers and builders fetched from registry API
- ✅ **Schema-Driven Forms**: Configuration forms generated from schemas
- ✅ **Compatibility Filtering**: Builders filtered based on provider selection
- ✅ **Type Safety**: Full TypeScript support throughout
- ✅ **Great UX**: Progressive disclosure, loading states, clear feedback
- ✅ **Maintainability**: Separation of concerns, reusable components
- ✅ **Extensibility**: Easy to add new providers/builders without frontend changes

This implementation provides a solid foundation for a scalable, maintainable service creation flow that adapts automatically to backend changes.
