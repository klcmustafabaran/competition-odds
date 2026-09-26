// Basit bellek içi önbellek. Aynı isteği TTL süresi boyunca tekrar API'ye göndermez,
// böylece günlük API kotası korunur. Eşzamanlı aynı istekler de tek istekte birleşir.
const store = new Map();

export function cached(key, ttlSeconds, loader) {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise;

  const promise = loader().catch((err) => {
    store.delete(key);
    throw err;
  });
  store.set(key, { promise, expires: Date.now() + ttlSeconds * 1000 });
  return promise;
}
