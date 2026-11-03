"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");

// ---- PIN hashing (scrypt, per-PIN random salt) ----
function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
const DUMMY = hashPin("dummy-pin-for-timing");
function verifyPin(pin, stored) {
  const [, saltHex, hashHex] = String(stored || DUMMY).split("$");
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(String(pin), Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(actual, expected) && stored !== undefined && stored !== null;
}
// Random numeric PIN, uniform (no modulo bias)
function randomPin(digits = 8) {
  return String(crypto.randomInt(0, 10 ** digits)).padStart(digits, "0");
}

// ---- Sessions (kept in memory, mirrored to a file so a restart does not sign everyone out) ----
class Sessions {
  constructor(hours, file) {
    this.ttl = hours * 3600e3; this.map = new Map(); this.file = file || null;
    if (this.file && fs.existsSync(this.file)) {
      try {
        const now = Date.now();
        for (const [k, s] of JSON.parse(fs.readFileSync(this.file, "utf8"))) if (s.exp > now) this.map.set(k, s);
      } catch { /* corrupt file: start with no sessions */ }
    }
  }
  _save() {
    if (!this.file) return;
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify([...this.map]), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  static key(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
  create(data) {
    const token = crypto.randomBytes(32).toString("hex");
    this.map.set(Sessions.key(token), { ...data, exp: Date.now() + this.ttl });
    this._save();
    return token;
  }
  get(token) {
    if (!token) return null;
    const k = Sessions.key(token), s = this.map.get(k);
    if (!s) return null;
    if (s.exp < Date.now()) { this.map.delete(k); this._save(); return null; }
    return s;
  }
  destroy(token) { if (token) { this.map.delete(Sessions.key(token)); this._save(); } }
  destroyFor(kind, id) {
    for (const [k, s] of this.map) if (s.kind === kind && s.id === id) this.map.delete(k);
    this._save();
  }
}

// ---- Login throttling: lock a (account + client) pair after repeated failures ----
class Throttle {
  constructor(max = 5, lockMs = 15 * 60e3) { this.max = max; this.lockMs = lockMs; this.map = new Map(); }
  locked(key) {
    const e = this.map.get(key);
    return !!e && e.until > Date.now();
  }
  fail(key) {
    const e = this.map.get(key) || { n: 0, until: 0 };
    if (e.until && e.until <= Date.now()) { e.n = 0; e.until = 0; }
    e.n += 1;
    if (e.n >= this.max) e.until = Date.now() + this.lockMs;
    this.map.set(key, e);
  }
  ok(key) { this.map.delete(key); }
}

module.exports = { hashPin, verifyPin, randomPin, Sessions, Throttle };
