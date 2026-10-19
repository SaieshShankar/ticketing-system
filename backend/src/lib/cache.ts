import redis from "./redis";

export const cacheKey = {
  summary: (projectId: string) => `summary:${projectId}`,
  dashboard: (userId: string) => `dashboard:${userId}`,
};

export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {}

  const data = await fn();

  try {
    await redis.set(key, JSON.stringify(data), "EX", ttlSeconds);
  } catch {}

  return data;
}

export async function invalidate(...keys: (string | null | undefined)[]) {
  const valid = keys.filter(Boolean) as string[];
  if (!valid.length) return;
  try {
    await redis.del(...valid);
  } catch {}
}