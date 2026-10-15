const Redis = require('ioredis');
const config = require('./config');

const redisOptions = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => {
    if (times > 3) return null; // Berhenti retry jika Redis tidak terjangkau (misal saat unit testing)
    return Math.min(times * 200, 1000);
  },
};

const redis = new Redis(redisOptions);
const redisPub = new Redis(redisOptions);
const redisSub = new Redis(redisOptions);

redis.on('error', (err) => {
  if (process.env.NODE_ENV !== 'test') {
    console.error('[Redis Client] Error:', err.message);
  }
});

redisPub.on('error', (err) => {
  if (process.env.NODE_ENV !== 'test') {
    console.error('[Redis Pub] Error:', err.message);
  }
});

redisSub.on('error', (err) => {
  if (process.env.NODE_ENV !== 'test') {
    console.error('[Redis Sub] Error:', err.message);
  }
});

module.exports = {
  redis,
  redisPub,
  redisSub,
};
