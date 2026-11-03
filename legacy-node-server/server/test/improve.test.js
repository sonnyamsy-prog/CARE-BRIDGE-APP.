"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { isEmergency } = require("../lib/risk");

async function boot(dir, extra = {}) {
  const { server } = createApp({ dataDir: dir, ownerId: "owner", ownerPin: "owner-pin-1", maxFails: 3, ...extra });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body, token) => {
    const r = await fetch(base + "/api" + p, { method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json() };
  };
  return { call, close: () => new Promise((r) => server.close(r)) };
}

test("sessions survive a server restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-sess-"));
  let app = await boot(dir);
  const { json } = await app.call("POST", "/login", { role: "staff", id: "owner", pin: "owner-pin-1" });
  await app.close();
  app = await boot(dir);
  assert.strictEqual((await app.call("GET", "/patients", null, json.token)).status, 200);
  await app.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test("account lockout holds even when the failures come from many clients", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-lock-"));
  const app = await boot(dir);
  let last;
  for (let i = 0; i < 12; i++) last = await app.call("POST", "/login", { role: "staff", id: "owner", pin: "nope" + i });
  assert.strictEqual(last.status, 429);
  assert.strictEqual((await app.call("POST", "/login", { role: "staff", id: "owner", pin: "owner-pin-1" })).status, 429);
  await app.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test("urgent tick box raises a red alert and fires the webhook with no personal details", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-urg-"));
  const hooks = [];
  const hookSrv = require("node:http").createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { hooks.push(b); res.end("ok"); });
  });
  await new Promise((r) => hookSrv.listen(0, "127.0.0.1", r));
  const app = await boot(dir, { alertWebhook: `http://127.0.0.1:${hookSrv.address().port}/` });
  const o = (await app.call("POST", "/login", { role: "staff", id: "owner", pin: "owner-pin-1" })).json;
  const reg = (await app.call("POST", "/patients", { name: "Jane Secret", dx: "HF", dept: "Cardiology" }, o.token)).json;
  const pt = (await app.call("POST", "/login", { role: "patient", id: reg.patient.code, pin: reg.pin })).json;
  await app.call("POST", `/patients/${pt.pid}/checkins`, { a: { meds: true, sw: false, br: false, fv: false }, note: "", urgent: true }, pt.token);
  const list = (await app.call("GET", "/patients", null, o.token)).json;
  assert.strictEqual(list[0].checkins[0].em, true);
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(hooks.length, 1);
  assert.ok(hooks[0].includes(reg.patient.code));
  assert.ok(!hooks[0].includes("Jane"));
  await app.close(); hookSrv.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test("emergency phrases: more wordings caught, ordinary notes not", () => {
  for (const n of ["my chest is paining", "chest feels tight", "I passed out", "can't catch my breath", "nimezimia"]) assert.ok(isEmergency(n), n);
  for (const n of ["chest is fine", "I feel better today", "a little tired"]) assert.ok(!isEmergency(n), n);
});

test("department is required, must be on the list, and is saved with the registering nurse", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-dept-"));
  const app = await boot(dir);
  const o = (await app.call("POST", "/login", { role: "staff", id: "owner", pin: "owner-pin-1" })).json;
  assert.strictEqual((await app.call("POST", "/patients", { name: "A", dx: "B" }, o.token)).status, 400);
  assert.strictEqual((await app.call("POST", "/patients", { name: "A", dx: "B", dept: "Made up" }, o.token)).status, 400);
  const r = await app.call("POST", "/patients", { name: "A", dx: "B", dept: "Renal" }, o.token);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.patient.dept, "Renal");
  assert.strictEqual(r.json.patient.nurseId, "owner");
  await app.close(); fs.rmSync(dir, { recursive: true, force: true });
});
