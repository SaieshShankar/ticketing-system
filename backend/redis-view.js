require("dotenv").config();
const Redis = require("ioredis");

(async () => {
  const redis = new Redis(process.env.REDIS_URL);
  const keys = await redis.keys("*");
  console.log(`Found ${keys.length} keys\n`);

  for (const key of keys) {
    const ttl = await redis.ttl(key);
    const value = await redis.get(key);
    console.log(`KEY: ${key}\nTTL: ${ttl}s\nVALUE: ${value}\n`);
  }
  redis.disconnect();
})();