module.exports = function (client) {
  return async function getThreadHistory(threadID, _amount, _timestamp, callback) {
    // FCA permits getThreadHistory(threadID, amount, callback) and
    // getThreadHistory(threadID, callback) with the timestamp omitted.
    if (typeof _amount === "function") {
      callback = _amount;
      _amount = null;
      _timestamp = null;
    } else if (typeof _timestamp === "function") {
      callback = _timestamp;
      _timestamp = null;
    }
    const cb = typeof callback === "function" ? callback : null;
    let items;
    try {
      const requested = _amount == null ? 20 : Number(_amount);
      if (!Number.isInteger(requested) || requested <= 0) {
        throw new TypeError("getThreadHistory: amount must be a positive integer");
      }
      items = await client.api.getThreadHistory(String(threadID), requested, _timestamp);
    } catch (error) {
      if (cb) {
        await cb(error, null);
        return [];
      }
      return [];
    }

    // Invoke user code outside the operation try/catch. A callback exception
    // belongs to the caller and must not cause a second callback(error, null).
    if (cb) await cb(null, items);
    return items;
  };
};
