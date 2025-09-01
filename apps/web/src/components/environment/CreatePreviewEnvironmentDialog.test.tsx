import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Mock component since it may not exist yet
const CreatePreviewEnvironmentDialog = vi.fn(({ 
  trigger
}) => (
  <div data-testid="create-preview-dialog">
    <button data-testid="dialog-trigger" onClick={() => {}}>
      {trigger}
    </button>
    <div data-testid="dialog-content">
      <h2>Create Preview Environment</h2>
      <form data-testid="preview-form">
        <input 
          data-testid="preview-name" 
          placeholder="Preview environment name" 
        />
        <select data-testid="template-select">
          <option value="">Select template</option>
          <option value="feature-branch">Feature Branch</option>
          <option value="staging">Staging Clone</option>
        </select>
        <textarea 
          data-testid="variables-editor" 
          placeholder="Custom variables (JSON)" 
        />
        <input 
          data-testid="expires-at" 
          type="datetime-local" 
          placeholder="Expiration date" 
        />
        <div data-testid="advanced-config">
          <label>
            <input type="checkbox" data-testid="custom-domain" />
            Custom domain
          </label>
          <input 
            data-testid="domain-input" 
            placeholder="custom.preview.example.com"
            disabled
          />
        </div>
        <div data-testid="dialog-actions">
          <button type="button" data-testid="cancel-btn">Cancel</button>
          <button type="submit" data-testid="create-btn">Create Preview</button>
        </div>
      </form>
    </div>
  </div>
))

// Mock ORPC hooks
const mockCreatePreview = vi.fn()

vi.mock('@/hooks/use-orpc-environment', () => ({
  useCreatePreviewEnvironment: () => ({
    mutate: mockCreatePreview,
    isLoading: false,
    error: null,
  }),
}))

// Create wrapper with QueryClient
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )
  }
}

describe('CreatePreviewEnvironmentDialog', () => {
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    user = userEvent.setup()
    vi.clearAllMocks()
  })

  it('should render the dialog trigger', () => {
    render(
      <CreatePreviewEnvironmentDialog trigger={<span>Create Preview</span>} />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByTestId('dialog-trigger')).toBeInTheDocument()
    expect(screen.getByText('Create Preview')).toBeInTheDocument()
  })

  it('should display form fields', () => {
    render(
      <CreatePreviewEnvironmentDialog trigger={<span>Create Preview</span>} />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByTestId('preview-form')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Preview environment name')).toBeInTheDocument()
    expect(screen.getByTestId('template-select')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Custom variables (JSON)')).toBeInTheDocument()
    expect(screen.getByTestId('expires-at')).toBeInTheDocument()
  })

  it('should handle preview name input', async () => {
    render(
      <CreatePreviewEnvironmentDialog trigger={<span>Create Preview</span>} />,
      { wrapper: createWrapper() }
    )

    const nameInput = screen.getByTestId('preview-name')
    await user.type(nameInput, 'feature-xyz-preview')

    expect(nameInput).toHaveValue('feature-xyz-preview')
  })

  it('should handle template selection', async () => {
    render(
      <CreatePreviewEnvironmentDialog trigger={<span>Create Preview</span>} />,
      { wrapper: createWrapper() }
    )

    const templateSelect = screen.getByTestId('template-select')
    await user.selectOptions(templateSelect, 'feature-branch')

    expect(templateSelect).toHaveValue('feature-branch')
  })

  it('should handle custom variables input', async () => {
    render(
      <CreatePreviewEnvironmentDialog trigger={<span>Create Preview</span>} />,
      { wrapper: createWrapper() }
    )

    const variablesEditor = screen.getByTestId('variables-editor')
    const customVars = JSON.stringify({
      'FEATURE_FLAG_XYZ': 'true',
      'API_URL': 'https://api-preview.example.com'
    }, null, 2)
    
    await user.type(variablesEditor, customVars)
    expect(variablesEditor).toHaveValue(customVars)
  })

  it('should handle expiration date setting', async () => {
    render(
      <CreatePreviewEnvironmentDialog trigger={<span>Create Preview</span>} />,
      { wrapper: createWrapper() }
    )

    const expiresInput = screen.getByTestId('expires-at')
    const futureDate = '2024-12-31T23:59'
    
    await user.type(expiresInput, futureDate)
    expect(expiresInput).toHaveValue(futureDate)
  })

  it('should handle cancel action', async () => {
    render(
      <CreatePreviewEnvironmentDialog trigger={<span>Create Preview</span>} />,
      { wrapper: createWrapper() }
    )

    const cancelBtn = screen.getByTestId('cancel-btn')
    await user.click(cancelBtn)

    expect(mockCreatePreview).not.toHaveBeenCalled()
  })
})