import { redisCmd } from './redis';

export const HOUR_MS = 3_600_000;
const MAX_LOOKAHEAD_WINDOWS = 24 * 30; // search up to 30 days ahead

export interface Slot {
  /** Hour-window index (floor(epochMs / 1h)) the email was assigned to. */
  window: number;
  /** Zero-based position inside that window; used to spread jobs out and keep order. */
  index: number;
}

export const windowOf = (ms: number): number => Math.floor(ms / HOUR_MS);

/**
 * Reserve one send slot for `senderId` in the earliest window >= the current one that still has capacity.
 * Counters live in Redis keyed by `rl:{sender}:{window}` so the limit is shared by all workers/instances.
 */
export async function reserveSlot(senderId: number, limit: number, nowMs = Date.now()): Promise<Slot> {
  const [window, index] = await redisCmd.reserveSlot(
    `rl:${senderId}:`,
    windowOf(nowMs),
    limit,
    // keep counters long enough to cover far-future reservations
    (MAX_LOOKAHEAD_WINDOWS + 2) * 3600,
    MAX_LOOKAHEAD_WINDOWS,
  );
  if (window < 0) throw new Error(`No capacity within ${MAX_LOOKAHEAD_WINDOWS} hours for sender ${senderId}`);
  return { window, index };
}
