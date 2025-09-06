import { z } from "zod";

export const Route = {
  name: "InternalQueryStateFromZodExample",
  params: z.object({
  }),
  search: z.object({
  // Basic string field
  search: z.string().default(''),
  
  // Enum field
  category: z.enum(['electronics', 'clothing', 'books', 'home']).default('electronics'),
  
  // Number fields
  page: z.number().int().min(1).default(1),
  priceMin: z.number().min(0).default(0),
  priceMax: z.number().min(0).default(1000),
  
  // Boolean field
  onSale: z.boolean().default(false),
  inStock: z.boolean().default(true),
  
  // Array field
  tags: z.array(z.string()).default([]),
  
  // Flattened advanced filters (instead of nested object)
  brand: z.string().default(''),
  rating: z.number().min(1).max(5).default(1),
  featured: z.boolean().default(false),
  
  // Date field (as string)
  dateFrom: z.string().default(''),
  dateTo: z.string().default(''),
  
  // Literal values
  sortBy: z.enum(['name', 'price', 'rating', 'date']).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc')
})
};

