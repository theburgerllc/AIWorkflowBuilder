const NodeCache = require('node-cache');

// Initialize cache with default TTL of 1 hour
const cache = new NodeCache({ 
  stdTTL: 3600,
  checkperiod: 120,
  useClones: false
});

// Cache events logging
cache.on('set', (key) => {
  console.debug(`Cache SET: ${key}`);
});

cache.on('expired', (key) => {
  console.debug(`Cache EXPIRED: ${key}`);
});

module.exports = cache;