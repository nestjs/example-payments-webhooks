import { z } from 'zod';

export const setQuantitySchema = z.object({
  quantity: z.number().int().min(1).max(100),
});
export type SetQuantityDto = z.infer<typeof setQuantitySchema>;
