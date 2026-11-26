import { z } from 'zod';

const name = z.string().trim().min(1).max(200);
const description = z.string().max(5_000);
// In cents: 1999 is 19.99.
const price = z.number().int().positive().max(10_000_000);
const stock = z.number().int().min(0);

export const createProductSchema = z.object({ name, description: description.default(''), price, stock });
export type CreateProductDto = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({ name, description, price, stock, active: z.boolean() }).partial();
export type UpdateProductDto = z.infer<typeof updateProductSchema>;

export const listProductsQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
