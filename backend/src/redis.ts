import IORedis from 'ioredis';
import { config } from './config';

// BullMQ requires maxRetriesPerRequest: null for blocking connections.
export const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

// Atomically find the first hour window (starting at ARGV[1]) whose counter is below the limit,
// reserve one slot in it, and return {windowIndex, slotIndexInWindow}.
// Runs as one Lua script, so concurrent workers/instances can never over-allocate a window.
const RESERVE_SLOT_LUA = `
local prefix = KEYS[1]
local startWindow = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local maxLookahead = tonumber(ARGV[4])
for i = 0, maxLookahead do
  local w = startWindow + i
  local key = prefix .. w
  local c = tonumber(redis.call('GET', key) or '0')
  if c < limit then
    redis.call('INCR', key)
    redis.call('EXPIRE', key, ttl)
    return {w, c}
  end
end
return {-1, 0}
`;

connection.defineCommand('reserveSlot', { numberOfKeys: 1, lua: RESERVE_SLOT_LUA });

export interface RedisWithCommands {
  reserveSlot(key: string, ...args: (string | number)[]): Promise<[number, number]>;
}

export const redisCmd = connection as unknown as RedisWithCommands;
