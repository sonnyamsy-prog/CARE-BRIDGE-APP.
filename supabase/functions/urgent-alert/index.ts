// Edge Function "urgent-alert": sends a short push when an URGENT (red) check-in is saved.
// Hook it up with a Database Webhook (see README). Only the patient code is sent, never names or health details.
// Secrets to set: ALERT_WEBHOOK_URL (Slack/Teams/ntfy/SMS gateway URL) and WEBHOOK_SECRET (any long random text).
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-webhook-secret") !== Deno.env.get("WEBHOOK_SECRET")) return new Response("forbidden", { status: 403 });
    const hook = Deno.env.get("ALERT_WEBHOOK_URL");
    if (!hook) return new Response("no webhook configured");
    const body = await req.json();
    const rec = body.record;
    if (body.type !== "INSERT" || !rec || rec.risk !== "red") return new Response("ignored");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: p } = await admin.from("patients").select("code").eq("id", rec.patient_id).single();
    await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `CareBridge URGENT check-in: ${p?.code ?? "unknown patient"}. Open the Alerts tab.` }),
      signal: AbortSignal.timeout(5000) });
    return new Response("sent");
  } catch (_e) {
    return new Response("error", { status: 500 });
  }
});
