<p align="center">
  <img src="public/icon-512.png" alt="CareBridge icon" width="120">
</p>

<h1 align="center">CareBridge</h1>

<p align="center">Post-discharge recovery monitoring for hospitals and patients.<br>An installable, offline-tolerant Progressive Web App (PWA).</p>

---

## What it does

- **Patients** sign in with a code and PIN and answer four daily yes/no questions: medicine taken, swelling, breathlessness, fever. They can add a free-text note and message their nurse.
- **Nurses** register discharged patients, see a risk-sorted patient list, review and acknowledge alerts, reply to messages, reset PINs and close monitoring.
- **Owner/admin** can also create nurse (staff) accounts.
- Warning signs (for example "chest pain" or "faint" in a note) raise an urgent alert. Nurses make every clinical decision; the app only flags and routes.

## Project structure

```
carebridge/
├── public/                    # Front end, served at /
│   ├── index.html             # Single-file UI (HTML + CSS + JS, no build step)
│   ├── manifest.webmanifest   # PWA manifest
│   ├── sw.js                  # Service worker (network-first, cache fallback)
│   ├── icon-192.png
│   └── icon-512.png
├── server/                    # Back end: Node.js, zero npm dependencies
│   ├── server.js              # API + static file server
│   ├── lib/risk.js            # Risk rules and emergency-phrase detection
│   ├── lib/auth.js            # PIN hashing, sessions, login throttling
│   ├── lib/store.js           # JSON-file storage and audit log
│   ├── scripts/backup.js      # npm run backup
│   └── test/                  # node:test suites
├── .github/                   # CI workflow, Dependabot, issue and PR templates
├── .env.example               # Configuration reference
├── CONTRIBUTING.md  CODE_OF_CONDUCT.md  SECURITY.md  PRIVACY.md  LICENSE
└── README.md
```

## Quick start

You need **Node.js 20 or newer**. There is nothing to `npm install`.

```bash
cd server
OWNER_ID=owner OWNER_PIN=choose-a-long-pin npm start
```

Open http://localhost:3000 and sign in as **Staff** with the owner ID and PIN. The owner account is created on the first run only. Then:

1. Create nurse accounts in the **Staff** tab (owner only).
2. Register a discharged patient in **Register**, choosing their department (Cardiology, Renal, and so on). You get a patient code and a one-time 8-digit PIN to give to the patient.
3. The patient signs in with that code and PIN and does the daily check-in.

Run the tests with `npm test`. See `.env.example` for all settings (port, data folder, time zone, proxy, HSTS).

## How risk is flagged

| Answer | Points |
|---|---|
| Did not take medicine | 1 |
| New swelling | 2 |
| Fever or chills | 2 |
| Short of breath | 3 |

A check-in is **Urgent (red)** if the patient reports shortness of breath, writes an emergency phrase (such as "chest pain" or "kuzimia"), or scores 4 or more. It is **Needs a call (amber)** with any other warning sign, and **On track (green)** with none. These rules only flag; nurses make every clinical decision. The rules live in `server/lib/risk.js` and in `public/index.html`, and a test keeps both identical. Have a clinician review them before real use.

## API

All routes are under `/api`, JSON in and out, with `Authorization: Bearer <token>`. Errors return `{ "error": "message" }`.

| Method | Route | Who | Purpose |
|---|---|---|---|
| POST | `/login` | anyone | `{role: "staff"\|"patient", id, pin}` returns `{token, role, user, admin, pid}` |
| POST | `/logout` | signed in | End the session |
| GET | `/patients` | staff: all; patient: own record | List patients |
| POST | `/patients` | staff | Register a patient; returns `{pin, patient}` (PIN shown once) |
| POST | `/patients/:id/checkins` | that patient | Daily check-in `{a: {meds, sw, br, fv}, note}` |
| POST | `/patients/:id/checkins/:i/ack` | staff | Acknowledge an alert |
| POST | `/patients/:id/log` | staff or that patient | Send a message `{text}` |
| POST | `/patients/:id/status` | staff | `monitoring` or `closed` |
| POST | `/patients/:id/resetpin` | staff | New PIN; the old PIN and its sessions stop working |
| POST | `/staff` | owner | Create a nurse `{id, name, pin}` (PIN 6+ characters) |

## What changed in this version

- **Sessions survive restarts** (stored in `sessions.json` inside `DATA_DIR`).
- **Patient PINs are 8 digits**, and each account also locks after repeated failures from any mix of IPs.
- **Urgent alerts can be pushed**: set `ALERT_WEBHOOK_URL` and a message with only the patient code is sent.
- **Missed check-ins** appear on the Alerts tab after midday.
- **Patients** can tick "I have chest pain, or I feel faint", resend a check-in answered by mistake, and check in offline (it sends when the phone reconnects).
- **Nurses** see a 7-day trend strip on each patient. More emergency wordings are detected.
- `render.yaml` sets up Render with a persistent disk.

## Dependencies

**None.** The front end has no scripts, fonts or external requests, and the server uses only Node.js built-in modules (`http`, `crypto`, `fs`, `node:test`). That means no supply-chain risk from packages and nothing to patch except Node.js itself, so keep Node on a supported release. Dependabot and `npm audit` in CI will alert you if a dependency is ever added.

## Deploy on Render

1. Push this project to GitHub with the folders exactly as shown above. `server/package.json` must exist in the repo (check on github.com before deploying).
2. In Render choose **New → Web Service** and connect the repo.
3. Use these settings:

| Setting | Value |
|---|---|
| Language | **Node** |
| Branch | `main` |
| Root Directory | `server` |
| Build Command | `npm install` |
| Start Command | `npm start` |

4. Add environment variables: `OWNER_ID`, `OWNER_PIN` (a long, unique PIN), `TZ_NAME` (for example `Africa/Nairobi`), `TRUST_PROXY=1` and `HSTS=1`. Render supplies `PORT` itself.
5. Click **Create Web Service**. When the build finishes, open the URL Render gives you and sign in as **Staff** with your owner ID and PIN.

**Keep your data:** on Render's free plan the disk is wiped on every restart or redeploy, which would delete all patients and check-ins. For real use, pick a paid plan, attach a persistent disk (for example mounted at `/var/data`), and set `DATA_DIR=/var/data`.

**Common build errors**

| Error | Cause and fix |
|---|---|
| `Root directory "server" does not exist` | The `server/` folder is not on GitHub. Upload it, then redeploy. |
| `Could not read package.json` at `/src/package.json` | Root Directory is empty or wrong. Set it to `server`. |
| `go build` or `Using Go version` in the log | The service was created with the wrong Language. Create a new service with **Node**. |

## Run in production

- [ ] Run behind HTTPS (for example Caddy or Nginx) and set `HSTS=1` and, if behind a proxy, `TRUST_PROXY=1`
- [ ] Set `DATA_DIR` to an encrypted disk outside the repo, and schedule `npm run backup` with encrypted off-site copies
- [ ] Use a long, unique `OWNER_PIN`, then remove it from the environment after the first run
- [ ] Keep Node.js updated; run the server as a non-root user
- [ ] Review `audit.log` regularly
- [ ] Read [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md) and complete their checklists

The JSON-file storage suits a pilot or a single clinic. Move to a proper database before wider use.

## Safety and privacy

CareBridge supports clinicians and does not replace them. Patient health data is sensitive: use HTTPS, hashed PINs, access logging, and follow your hospital's and your country's data-protection rules (for example Kenya's Data Protection Act, 2019).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Roadmap

- Swahili in the main app (the demo already has it)
- SMS and voice check-ins for patients without smartphones
- Hospital-specific care plans
- SMS delivery of urgent alerts (the webhook can already feed a gateway)
- Patient data export and automatic deletion after the retention period
- A real database for larger deployments

## License

[MIT](LICENSE)
