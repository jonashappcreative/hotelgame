import { z } from 'zod';

// Player name validation
export const playerNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(20, 'Name must be 20 characters or less')
  .regex(/^[a-zA-Z0-9\s]+$/, 'Name can only contain letters, numbers, and spaces');

// Room code validation
export const roomCodeSchema = z
  .string()
  .trim()
  .length(6, 'Room code must be 6 characters')
  .regex(/^[A-Z0-9]+$/i, 'Invalid room code format')
  .transform(val => val.toUpperCase());

// Validate player name
export const validatePlayerName = (name: string): { valid: boolean; error?: string } => {
  const result = playerNameSchema.safeParse(name);
  if (result.success) {
    return { valid: true };
  }
  return { valid: false, error: result.error.errors[0]?.message || 'Invalid name' };
};

// Validate room code
export const validateRoomCode = (code: string): { valid: boolean; error?: string; normalized?: string } => {
  const result = roomCodeSchema.safeParse(code);
  if (result.success) {
    return { valid: true, normalized: result.data };
  }
  return { valid: false, error: result.error.errors[0]?.message || 'Invalid room code' };
};

// Stock purchase validation
export const stockPurchaseSchema = z.object({
  chain: z.enum(['sackson', 'tower', 'worldwide', 'american', 'festival', 'continental', 'imperial']),
  quantity: z.number().int().min(0).max(3),
});

export const stockPurchasesSchema = z.array(stockPurchaseSchema).refine(
  (purchases) => {
    const total = purchases.reduce((sum, p) => sum + p.quantity, 0);
    return total <= 3;
  },
  { message: 'Cannot purchase more than 3 stocks per turn' }
);

// Merger stock decision validation
export const mergerStockDecisionSchema = z.object({
  sell: z.number().int().min(0),
  trade: z.number().int().min(0),
  keep: z.number().int().min(0),
}).refine(
  (decision) => decision.trade % 2 === 0,
  { message: 'Trade amount must be even (2:1 ratio)' }
);
