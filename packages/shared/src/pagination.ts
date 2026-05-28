import { z } from "zod";

// Pagination query validator (snake_case input -> camelCase output)
export const paginationQuerySchema = z.object({
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  page_token: z.string().optional(),
}).transform((data) => ({
  pageSize: data.page_size,
  pageToken: data.page_token,
}));

export type PaginationQueryInput = z.input<typeof paginationQuerySchema>;
export type PaginationQueryOutput = z.output<typeof paginationQuerySchema>;

// Pagination result payload type (internal camelCase)
export interface PaginatedResult<T> {
  items: T[];
  nextPageToken?: string;
  hasMore: boolean;
}

// Function to serialize internal PaginatedResult to external snake_case JSON
export function serializePaginatedResult<T, U>(
  result: PaginatedResult<T>,
  itemSerializer: (item: T) => U,
) {
  return {
    items: result.items.map(itemSerializer),
    next_page_token: result.nextPageToken,
    has_more: result.hasMore,
  };
}
