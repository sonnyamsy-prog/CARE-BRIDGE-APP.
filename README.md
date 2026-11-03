# CareBridge (complete)

Post-discharge recovery monitoring for hospitals in Kenya. Patients answer four daily questions; nurses see a risk-sorted list, urgent alerts, missed check-ins and messages.

```
public/                  the app (static site: sign-in, nurse and patient screens, installable on phones, offline check-ins)
schema.sql               database, security rules, organizations, authenticator-code enforcement, audit trail
supabase/functions/
  patients/              register patients and reset PINs (uses the secret key, server side only)
  urgent-alert/          optional push message when an URGENT check-in arrives
docs/                    PRIVACY.md and SECURITY.md (written for the first version; review before real use)
legacy-node-server/      the first, self-hosted version (Node + Render). Not needed for the Supabase version.
```

## Setup, in order
1. **Supabase > SQL Editor**: paste `schema.sql`, Run. (It deletes any older CareBridge tables first.)
2. **Authentication > Users > Add user**: create your staff user (tick Auto Confirm) and copy its ID.
3. **SQL Editor**: run the three lines at the bottom of the "FIRST-TIME SETUP" block with your IDs filled in and the leading `--` removed. The first returns your **Organization ID**: save it.
4. **Edge Functions**: create a function named exactly `patients`, paste `supabase/functions/patients/index.ts`, deploy.
5. Open `public/index.html` and set `CFG.url` and `CFG.key` (Project URL and the *public* key only, never the secret or service-role key).
6. Deploy `public/` as a Static Site (Render: Publish Directory `public`, Build Command empty).
7. Sign in as staff with Organization ID, email, password; scan the QR code with an authenticator app on first login.

More nurses: create them in Authentication > Users, then add a `profiles` row (role `staff`) and an `organization_members` row (role `nurse`).

## Optional: urgent alert push
1. Deploy `urgent-alert` as an Edge Function with "Verify JWT" **off**.
2. Set its secrets: `ALERT_WEBHOOK_URL` (Slack/Teams/ntfy/SMS gateway URL) and `WEBHOOK_SECRET` (long random text).
3. **Database > Webhooks > Create**: table `checkins`, event Insert, type Supabase Edge Function `urgent-alert`, add header `x-webhook-secret` with the same secret.

## Audit trail
Check-ins, acknowledgements, messages, registrations, status changes and PIN resets are recorded in the `audit_log` table (view it in Table Editor). Sign-in events are in Supabase's own Auth logs.
