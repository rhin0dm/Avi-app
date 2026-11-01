# Deploying AVI (Supabase + Vercel)

About 30 minutes, all in a web browser. A computer is easier than a phone for this part. You'll create three free accounts: GitHub (stores the code), Supabase (the database) and Vercel (runs the app).

Plan terms change. Check each service's current free-tier limits. Vercel's free Hobby plan is intended for non-commercial use, so review whether you need its paid plan. Supabase free projects may pause after a period of inactivity. Open the app now and then, or upgrade.

---

## 1. GitHub — store the code
1. Sign up at **github.com**.
2. Create a **private** repository named `avi` with no README. Choose **New repository** → Private → **Create**.
3. Get the code into it, using either option:
   - **Easiest:** in Claude, connect GitHub (Settings → Connectors → GitHub) and ask Claude to push the AVI code to your `avi` repo.
   - **Manually:** on the empty repo page, choose **uploading an existing file**. Drag in the *contents* of the unzipped `avi` folder, excluding `node_modules` and `.next`. Then choose **Commit**.

## 2. Supabase — the database
1. Sign up at **supabase.com** → **New project**.
   - Name: `avi`
   - Database password: generate a strong one and **save it in your password manager**.
   - Region: **Sydney (ap-southeast-2)**.
2. When the project is ready, open **SQL Editor** → **New query**.
3. Open `db/supabase-setup.sql` from the code, copy all of it, paste it into the editor and choose **Run**. You should see "Success. No rows returned".
4. Choose **Connect** at the top of the project. Under **Connection string**, pick **Transaction pooler** and copy the URI. It looks like:
   `postgresql://postgres.abcd1234:[YOUR-PASSWORD]@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`
5. Replace `[YOUR-PASSWORD]` with your database password. If the password contains `@ : / ? # %` or spaces, use the password generator again with letters and numbers only. That avoids URL-encoding problems.

You don't need Supabase's API keys. AVI connects to the database directly from the server, and the setup script locks the tables away from Supabase's public API.

## 3. Vercel — run the app
1. Sign up at **vercel.com** using **Continue with GitHub**.
2. Choose **Add New → Project** → import your `avi` repository.
3. Before you deploy, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `DATABASE_URL` | the Supabase URI from step 2.4–2.5 |
| `AUTH_SECRET` | a random string of 40+ letters and numbers from your password manager's generator |
| `AVI_OWNER_PASSWORD` | the password you'll use to sign in to AVI (12+ characters) |
| `ANTHROPIC_API_KEY` | your Anthropic API key (optional; enables AI idea interpretation) |
| `APP_TIMEZONE` | `Australia/Hobart` (or your city) |

   To use OpenAI instead, set `AI_PROVIDER=openai`, `OPENAI_API_KEY`, and `AI_MODEL` (the model name you want).
4. Choose **Deploy**. When it finishes, open the URL Vercel gives you, for example `avi-yourname.vercel.app`.
5. Sign in with `AVI_OWNER_PASSWORD`.

## 4. First use
1. **Import / export** → choose your *AVI Master Opportunity Register* `.xlsx` → **Preview import** → check the summary → **Import**.
2. **Settings** → enter savings and monthly personal spend to turn on the runway figure.
3. **Submit idea** → type an idea. With an API key set, the AI interpretation appears on the idea's page within about 20 seconds.
4. Open an opportunity → **Score** and **Financials** tabs.

Check the connection at any time: `https://your-app.vercel.app/api/health` should show `"database":"reachable"`.

## Backups
**Import / export → Full JSON backup** downloads every table, including history. Do this regularly. Supabase also keeps its own backups on paid plans.

## Updating the app later
Push new code to GitHub; Vercel redeploys automatically. If an update adds a file to `db/migrations/`, run that file in the Supabase SQL Editor. Or, from a computer with Node.js installed, run `DATABASE_URL=... npm run db:migrate`.

## Troubleshooting
- **"Server not configured" at sign-in:** `AUTH_SECRET` is under 32 characters, or `AVI_OWNER_PASSWORD` is missing or under 12 characters. Fix it in Vercel, then use **Deployments → Redeploy**.
- **/api/health says unreachable:** check the `DATABASE_URL` password and that you used the **Transaction pooler** URI on port 6543.
- **AI interpretation failed:** the job error appears in the opportunity's **History** tab. A 401 error means the API key is wrong. A 404 error mentioning the model means `AI_MODEL` names a model your key can't use.
