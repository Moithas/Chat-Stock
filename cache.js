// TTL cache utility for guild settings
// Wraps a Map with automatic expiration after a configurable TTL

const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

class TTLCache {
  constructor(ttl = DEFAULT_TTL) {
    this.cache = new Map();
    this.ttl = ttl;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set(key, value) {
    this.cache.set(key, { data: value, cachedAt: Date.now() });
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  get size() {
    return this.cache.size;
  }
}

module.exports = { TTLCache, DEFAULT_TTL };
