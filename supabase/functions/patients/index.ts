// Edge Function "patients": register a patient or reset a PIN. Runs on Supabase's servers,
// so the service-role key never reaches the browser. Only verified-MFA staff of the organization may call it.
import { createClient } from "npm:@supabase/supabase-js@2";

const DOMAIN = "patients.example.org"; // must match CFG.domain in public/index.html
const DEPTS = ["Cardiology", "Diabetes and endocrine", "Respiratory", "Renal", "Maternity", "General medical", "Surgical", "Paediatrics", "Other"];
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const newPin = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(a[0] % 100000000).padStart(8, "0"); };
const txt = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const b = await req.json();
    const { data: who } = await asUser.auth.getUser();
    if (!who?.user) return json({ error: "Please sign in again." }, 401);

    if (b.action === "register") {
      const { data: ok } = await asUser.rpc("is_org_staff", { org: b.org_id });
      if (!ok) return json({ error: "Not allowed. Sign in with your authenticator code first." }, 403);
      const name = txt(b.name, 100), dx = txt(b.dx, 200), dept = txt(b.dept, 40);
      if (!name || !dx) return json({ error: "Name and diagnosis are required." }, 400);
      if (!DEPTS.includes(dept)) return json({ error: "Please choose a department from the list." }, 400);
      const row: Record<string, unknown> = { name, dx, dept, age: txt(b.age, 3), phone: txt(b.phone, 30), ward: txt(b.ward, 100), meds: txt(b.meds, 1000), registered_by: who.user.id };
      if (b.dd) row.dd = txt(b.dd, 10);
      const { data: p, error: e1 } = await admin.from("patients").insert(row).select("id,code").single();
      if (e1 || !p) return json({ error: "Could not save the patient. " + (e1?.message ?? "") }, 400);
      const pin = newPin();
      const { data: u, error: e2 } = await admin.auth.admin.createUser({ email: p.code.toLowerCase() + "@" + DOMAIN, password: pin, email_confirm: true });
      if (e2 || !u?.user) { await admin.from("patients").delete().eq("id", p.id); return json({ error: "Could not create the patient login." }, 400); }
      const steps = [
        await admin.from("profiles").insert({ id: u.user.id, role: "patient", name }),
        await admin.from("patients").update({ user_id: u.user.id }).eq("id", p.id),
        await admin.from("patient_organizations").insert({ patient_id: p.id, organization_id: b.org_id }),
      ];
      if (steps.some((s) => s.error)) {
        await admin.from("patients").delete().eq("id", p.id); await admin.auth.admin.deleteUser(u.user.id);
        return json({ error: "Registration failed and was undone. Try again." }, 500);
      }
      return json({ code: p.code, pin });
    }

    if (b.action === "reset_pin") {
      const { data: ok } = await asUser.rpc("staff_can_see", { pid: b.patient_id });
      if (!ok) return json({ error: "Not allowed." }, 403);
      const { data: p } = await admin.from("patients").select("user_id,code").eq("id", b.patient_id).single();
      if (!p?.user_id) return json({ error: "Patient has no login." }, 400);
      const pin = newPin();
      const { error } = await admin.auth.admin.updateUserById(p.user_id, { password: pin });
      if (error) return json({ error: "Could not reset the PIN." }, 500);
      await admin.rpc("log_pin_reset", { actor: who.user.id, pid: b.patient_id });
      return json({ code: p.code, pin });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: "Something went wrong." }, 500);
  }
});
