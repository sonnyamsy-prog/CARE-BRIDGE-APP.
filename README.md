# CareBridge on Supabase (v2)

Static front end (`public/`) + Supabase database (`schema.sql`) + one Edge Function (`supabase/functions/patients`).

## Setup, in order
1. **Supabase > SQL Editor**: paste `schema.sql`, Run. (It deletes the older CareBridge tables first.)
2. **Authentication > Users > Add user**: create your own staff user (tick Auto Confirm). Copy the user ID.
3. **SQL Editor**, run the three lines at the bottom of `schema.sql` (uncommented, with your IDs filled in). The first returns your **Organization ID**.
4. **Authentication settings**: make sure multi-factor (TOTP) is enabled. Then **Edge Functions > Deploy a new function**, name it exactly `patients`, paste `supabase/functions/patients/index.ts`, deploy.
5. Open `public/index.html` and set `CFG.url` and `CFG.key` (Project URL and the public/anon key from the Connect panel). Never use the service-role or secret key here.
6. Deploy `public/` as a **Static Site** (Render: Publish Directory `public`, Build Command empty; Vercel/Netlify also work).
7. Sign in as staff with Organization ID, email, password; set up the authenticator on first login.

More nurses: create them in Authentication > Users, then add a `profiles` row (role `staff`) and an `organization_members` row (role `nurse`).
