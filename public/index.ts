// Edge Function "missed-checkins": run hourly by cron after the cutoff hour.
// For every discharged patient with no check-in today (Africa/Nairobi) it creates one call task
// and sends an SMS reminder. Dedupe is enforced by followups(patient_id, kind, due_date).
//
// Secrets: CRON_SECRET (required), AT_USERNAME, AT_API_KEY, AT_SENDER_ID, AT_SANDBOX,
//          SMS_COUNTRY_CODE, CUTOFF_HOUR. SMS is skipped (tasks are still created) when AT is not set.
import { createClient } from "npm:@supabase/supabase-js@2";

const TZ = "Africa/Nairobi";
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const todayIn = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const hourIn = () =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date()));

function normalizePhone(raw: unknown, cc: string) {
  const d = String(raw ?? "").replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (!d) return "";
  if (d.startsWith("0")) return cc + d.slice(1);
  if (d.startsWith(cc)) return d;
  return d;
}

async function sendSms(to: string, text: string) {
  const username = Deno.env.get("AT_USERNAME"), apiKey = Deno.env.get("AT_API_KEY");
  if (!username || !apiKey) return { ok: false, reason: "not_configured" };
  const base = Deno.env.get("AT_SANDBOX") === "1"
    ? "https://api.sandbox.africastalking.com"
    : "https://api.africastalking.com";
  const body = new URLSearchParams({ username, to, message: text });
  const sender = Deno.env.get("AT_SENDER_ID");
  if (sender) body.set("from", sender);
  const r = await fetch(base + "/version1/messaging", {
    method: "POST",
    headers: { apiKey: apiKey!, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal: AbortSignal.timeout(8000),
  });
  return r.ok ? { ok: true, reason: "" } : { ok: false, reason: "http_" + r.status };
}

type Candidate = { patient_id: number; organization_id: string; phone: string | null; code: string; name: string };

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ error: "forbidden" }, 403);
  try {
    const dry = new URL(req.url).searchParams.get("dry") === "1";
    const cutoff = Number(Deno.env.get("CUTOFF_HOUR") || "12");
    const hour = hourIn();
    if (!dry && hour < cutoff) return json({ skipped: "before_cutoff", hour });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await admin.rpc("missed_checkin_candidates");
    if (error) return json({ error: error.message }, 500);
    const candidates = (data ?? []) as Candidate[];

    const date = todayIn();
    const cc = Deno.env.get("SMS_COUNTRY_CODE") || "254";
    const text =
      "CareBridge: we have not received today's health check-in. Open the app and answer the 4 questions, or go to your nearest clinic if you feel unwell.";

    let created = 0, sent = 0, failed = 0, skipped = 0;
    const details: Record<string, unknown>[] = [];

    for (const c of candidates) {
      const phone = normalizePhone(c.phone, cc);
      const row = {
        patient_id: c.patient_id,
        organization_id: c.organization_id,
        kind: "missed_checkin",
        due_date: date,
      };
      if (dry) {
        details.push({ ...row, phone: phone ? "***" + phone.slice(-3) : "" });
        continue;
      }

      const ins = await admin
        .from("followups")
        .upsert(row, { onConflict: "patient_id,kind,due_date", ignoreDuplicates: true })
        .select("id");
      if (ins.error) {
        failed++;
        details.push({ patient_id: c.patient_id, error: ins.error.message });
        continue;
      }
      if (!ins.data || ins.data.length === 0) { skipped++; continue; } // task already existed
      created++;

      if (!phone) { details.push({ patient_id: c.patient_id, sms: "no_phone" }); continue; }

      const res = await sendSms(phone, text);
      if (!res.ok) {
        failed++;
        details.push({ patient_id: c.patient_id, sms: res.reason });
        continue;
      }
      sent++;
      await admin
        .from("followups")
        .update({ reminder_sent_at: new Date().toISOString(), reminder_channel: "sms" })
        .eq("patient_id", c.patient_id)
        .eq("kind", "missed_checkin")
        .eq("due_date", date);
    }

    return json({
      date,
      cutoff_hour: cutoff,
      candidates: candidates.length,
      created,
      sms_sent: sent,
      sms_failed: failed,
      skipped,
      details,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
