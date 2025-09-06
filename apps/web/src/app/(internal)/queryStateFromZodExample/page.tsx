'use client'

import React from 'react'
import { z } from 'zod'
import { useSafeQueryStatesFromZod } from '@/utils/useSafeQueryStatesFromZod'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Checkbox } from '@repo/ui/components/shadcn/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Slider } from '@repo/ui/components/shadcn/slider'
import { Alert, AlertDescription } from '@repo/ui/components/shadcn/alert'
import { useSearchParamState } from '@/routes/hooks'
import { InternalQueryStateFromZodExample } from '@/routes/index'
import { RouteBuilderSearch } from '@/routes/makeRoute'

type ExampleFilters = RouteBuilderSearch<typeof InternalQueryStateFromZodExample>

export default function QueryStateFromZodExamplePage() {
  // Use the enhanced hook with debouncing
  const [filters, setFilters] = useSearchParamState(InternalQueryStateFromZodExample, {
    delay: 300, // Debounce updates by 300ms
    history: 'push' // Use pushState for navigation
  })

  // Helper functions for different update patterns
  const handleSearch = (search: string) => {
    setFilters({ search, page: 1 }) // Reset page when searching
  }

  const handleCategoryChange = (category: ExampleFilters['category']) => {
    setFilters({ category, page: 1 })
  }

  const handlePriceRange = (priceMin: number, priceMax: number) => {
    setFilters({ priceMin, priceMax, page: 1 })
  }

  const handleSorting = (sortBy: ExampleFilters['sortBy'], sortOrder: ExampleFilters['sortOrder']) => {
    setFilters({ sortBy, sortOrder })
  }

  // Helper function to handle advanced filter updates
  const handleAdvancedFilter = <K extends keyof Pick<ExampleFilters, 'brand' | 'rating' | 'featured'>>(
    key: K, 
    value: ExampleFilters[K]
  ) => {
    setFilters({
      [key]: value
    })
  }

  const handleTagAdd = (newTag: string) => {
    const currentTags = filters.tags || []
    if (newTag && !currentTags.includes(newTag)) {
      setFilters({ tags: [...currentTags, newTag], page: 1 })
    }
  }

  const handleTagRemove = (tagToRemove: string) => {
    const currentTags = filters.tags || []
    setFilters({ 
      tags: currentTags.filter(tag => tag !== tagToRemove),
      page: 1 
    })
  }

  const handleReset = () => {
    setFilters(null) // Reset to default values
  }

  const handlePagination = (page: number) => {
    setFilters({ page })
  }

  // Simulate URL generation for API calls
  const generateApiUrl = () => {
    const params = new URLSearchParams()
    
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (typeof value === 'object' && !Array.isArray(value)) {
          // Handle nested objects
          Object.entries(value).forEach(([nestedKey, nestedValue]) => {
            if (nestedValue !== undefined && nestedValue !== null) {
              params.append(`${key}.${nestedKey}`, String(nestedValue))
            }
          })
        } else if (Array.isArray(value)) {
          // Handle arrays
          value.forEach(item => params.append(key, String(item)))
        } else {
          params.append(key, String(value))
        }
      }
    })
    
    return `/api/example?${params.toString()}`
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-3xl">
              Query State from Zod Example
            </CardTitle>
            <CardDescription>
              This page demonstrates the enhanced <code className="bg-gray-100 px-2 py-1 rounded">useSafeQueryStatesFromZod</code> hook 
              that works with Zod object schemas and uses nuqs&apos;s <code className="bg-gray-100 px-2 py-1 rounded">useQueryStates</code> for batching.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-semibold">Key Features:</p>
                  <ul className="text-sm space-y-1 ml-4">
                    <li>• Type-safe query parameters from Zod schemas</li>
                    <li>• Automatic batching of multiple parameter updates</li>
                    <li>• Built-in debouncing support</li>
                    <li>• Support for complex types (objects, arrays, enums)</li>
                    <li>• Default value handling</li>
                    <li>• Perfect TypeScript inference</li>
                  </ul>
                </div>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Filters Panel */}
          <div className="lg:col-span-2 space-y-6">
            {/* Search */}
            <Card>
              <CardHeader>
                <CardTitle>Search & Basic Filters</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="search">Search Query</Label>
                  <Input
                    id="search"
                    type="text"
                    value={filters.search}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder="Search products..."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Select 
                    value={filters.category} 
                    onValueChange={(value) => handleCategoryChange(value as ExampleFilters['category'])}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="electronics">Electronics</SelectItem>
                      <SelectItem value="clothing">Clothing</SelectItem>
                      <SelectItem value="books">Books</SelectItem>
                      <SelectItem value="home">Home & Garden</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="onSale"
                      checked={filters.onSale}
                      onCheckedChange={(checked) => setFilters({ onSale: !!checked, page: 1 })}
                    />
                    <Label htmlFor="onSale">On Sale</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="inStock"
                      checked={filters.inStock}
                      onCheckedChange={(checked) => setFilters({ inStock: !!checked, page: 1 })}
                    />
                    <Label htmlFor="inStock">In Stock</Label>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Price Range */}
            <Card>
              <CardHeader>
                <CardTitle>Price Range</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="priceMin">Min Price ($)</Label>
                    <Input
                      id="priceMin"
                      type="number"
                      value={filters.priceMin}
                      onChange={(e) => handlePriceRange(parseInt(e.target.value) || 0, filters.priceMax)}
                      min="0"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="priceMax">Max Price ($)</Label>
                    <Input
                      id="priceMax"
                      type="number"
                      value={filters.priceMax}
                      onChange={(e) => handlePriceRange(filters.priceMin, parseInt(e.target.value) || 1000)}
                      min="0"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Advanced Filters */}
            <Card>
              <CardHeader>
                <CardTitle>Advanced Filters</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="brand">Brand</Label>
                  <Input
                    id="brand"
                    type="text"
                    value={filters.brand || ''}
                    onChange={(e) => handleAdvancedFilter('brand', e.target.value)}
                    placeholder="Enter brand name..."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rating">
                    Minimum Rating: {filters.rating || 1}
                  </Label>
                  <Slider
                    id="rating"
                    min={1}
                    max={5}
                    step={1}
                    value={[filters.rating || 1]}
                    onValueChange={([value]) => handleAdvancedFilter('rating', value)}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>1 star</span>
                    <span>5 stars</span>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="featured"
                    checked={filters.featured || false}
                    onCheckedChange={(checked) => handleAdvancedFilter('featured', !!checked)}
                  />
                  <Label htmlFor="featured">Featured Products Only</Label>
                </div>
              </CardContent>
            </Card>

            {/* Tags */}
            <Card>
              <CardHeader>
                <CardTitle>Tags</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {(filters.tags || []).map((tag, index) => (
                    <Badge key={index} variant="secondary" className="text-sm">
                      {tag}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleTagRemove(tag)}
                        className="ml-2 h-4 w-4 p-0 hover:bg-transparent"
                      >
                        ×
                      </Button>
                    </Badge>
                  ))}
                  {(filters.tags || []).length === 0 && (
                    <span className="text-gray-500 text-sm">No tags selected</span>
                  )}
                </div>
                
                <div className="flex gap-2">
                  <Input
                    placeholder="Add a tag..."
                    className="flex-1"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleTagAdd((e.target as HTMLInputElement).value);
                        (e.target as HTMLInputElement).value = ''
                      }
                    }}
                  />
                  <Button
                    onClick={() => {
                      const input = document.querySelector('input[placeholder="Add a tag..."]') as HTMLInputElement
                      if (input?.value) {
                        handleTagAdd(input.value)
                        input.value = ''
                      }
                    }}
                  >
                    Add
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Sorting & Pagination */}
            <Card>
              <CardHeader>
                <CardTitle>Sorting & Pagination</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="sortBy">Sort By</Label>
                    <Select 
                      value={filters.sortBy} 
                      onValueChange={(value) => handleSorting(value as ExampleFilters['sortBy'], filters.sortOrder)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="name">Name</SelectItem>
                        <SelectItem value="price">Price</SelectItem>
                        <SelectItem value="rating">Rating</SelectItem>
                        <SelectItem value="date">Date</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="sortOrder">Order</Label>
                    <Select 
                      value={filters.sortOrder} 
                      onValueChange={(value) => handleSorting(filters.sortBy, value as ExampleFilters['sortOrder'])}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="asc">Ascending</SelectItem>
                        <SelectItem value="desc">Descending</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="page">Page</Label>
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePagination(Math.max(1, filters.page - 1))}
                        disabled={filters.page === 1}
                      >
                        ←
                      </Button>
                      <Input
                        id="page"
                        type="number"
                        value={filters.page}
                        onChange={(e) => handlePagination(Math.max(1, parseInt(e.target.value) || 1))}
                        min="1"
                        className="w-20 text-center"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePagination(filters.page + 1)}
                      >
                        →
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <Card>
              <CardHeader>
                <CardTitle>Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    variant="outline"
                    onClick={handleReset}
                  >
                    Reset All Filters
                  </Button>
                  <Button
                    onClick={() => navigator.clipboard.writeText(window.location.href)}
                  >
                    Copy URL
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Debug Panel */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Current State</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-gray-50 rounded-lg p-4 overflow-x-auto">
                  <pre className="text-xs text-gray-700">
                    {JSON.stringify(filters, null, 2)}
                  </pre>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Generated API URL</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-gray-50 rounded-lg p-4 mb-3">
                  <code className="text-xs text-gray-700 break-all">
                    {generateApiUrl()}
                  </code>
                </div>
                <p className="text-sm text-gray-600">
                  This URL could be used to fetch data from an API with the current filter state.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>URL Query Params</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-gray-50 rounded-lg p-4 mb-3">
                  <code className="text-xs text-gray-700 break-all">
                    {window.location.search || '(no params)'}
                  </code>
                </div>
                <p className="text-sm text-gray-600">
                  Notice how the URL updates automatically as you change filters, with debouncing applied.
                </p>
              </CardContent>
            </Card>

            <Alert>
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-semibold">Try This:</p>
                  <ul className="text-sm space-y-1 ml-4">
                    <li>• Change multiple filters quickly</li>
                    <li>• Notice the debounced URL updates</li>
                    <li>• Refresh the page - state persists!</li>
                    <li>• Copy and share the URL</li>
                    <li>• Check the browser back/forward buttons</li>
                  </ul>
                </div>
              </AlertDescription>
            </Alert>
          </div>
        </div>
      </div>
    </div>
  )
}