# Getting started — connect your first two Clay tables

This guide takes you from a new Mold deployment to one Clay table calling another and receiving its processed result in the same HTTP API step.

## 1. Generate an API token

Run this command locally:

```bash
openssl rand -hex 32
```

Keep the output. You will use the same token when deploying Mold, calling `/bridge` from Table A, and calling Mold back from Table B.

## 2. Deploy Mold

Choose one of the supported paths:

- [Deploy to Render](https://render.com/deploy?repo=https://github.com/eliasstravik/mold)
- [Deploy on Railway](https://railway.com/new/template?template=https://github.com/eliasstravik/mold)

Set `API_TOKEN` to the token you generated, wait for the deployment to finish, and copy the public service URL. It will look similar to `https://mold-xxxx.onrender.com` or `https://mold-production-xxxx.up.railway.app`.

On Railway, open **Settings → Networking → Generate Domain** if the service does not already have a public URL.

Confirm that Mold is running:

```bash
curl https://your-mold-url/health
```

The response should be:

```json
{ "ok": true }
```

### Run Mold somewhere else

```bash
git clone https://github.com/eliasstravik/mold.git
cd mold
npm install
npm run build
API_TOKEN=your-token npm start
```

Or use Docker:

```bash
docker build -t mold .
docker run -p 3000:3000 -e API_TOKEN=your-token mold
```

Use a single Mold process. Pending callbacks live in memory, so requests and callbacks cannot be distributed across multiple instances.

## 3. Prepare Table B

Table B is the reusable Clay workflow that performs the enrichment, scoring, classification, or other processing.

1. Open or create Table B in Clay.
2. Add **Pull in data from a Webhook** as its source.
3. Copy the webhook URL Clay provides.
4. If the webhook uses authentication, copy its authentication token too.

The webhook URL looks similar to:

```text
https://api.clay.com/v3/sources/webhook/abc123def456
```

## 4. Call Mold from Table A

Table A is the workflow that needs Table B's result.

Add an **HTTP API** column with these settings:

- **Method:** `POST`
- **URL:** `https://your-mold-url/bridge`
- **Authorization header:** `Bearer YOUR_API_TOKEN`
- **Content-Type header:** `application/json`

The body must include `_mold_target_url`, followed by the fields Table B needs:

```json
{
  "_mold_target_url": "https://api.clay.com/v3/sources/webhook/abc123def456",
  "first_name": "{{First Name}}",
  "email": "{{Email}}",
  "company": "{{Company}}"
}
```

If Table B's webhook requires authentication, include its token:

```json
{
  "_mold_target_url": "https://api.clay.com/v3/sources/webhook/abc123def456",
  "_mold_target_auth_token": "table-b-auth-token",
  "domain": "{{Company Domain}}"
}
```

Mold removes both `_mold_target_url` and `_mold_target_auth_token` before forwarding the row. Table B receives your data fields plus a generated `_mold_callback_url`.

## 5. Send the first row

Run one row in Table A. This first request will time out because Table B does not have its callback column yet. That is expected.

The request creates a row in Table B and exposes the incoming columns, including `_mold_callback_url`, so you can configure the final step.

## 6. Return Table B's result

Add the processing columns Table B needs, then add one **HTTP API** column as the final column.

Configure it with:

- **Method:** `POST`
- **URL:** `{{_mold_callback_url}}`
- **Authorization header:** `Bearer YOUR_API_TOKEN`
- **Content-Type header:** `application/json`

Use the same Mold API token from the deployment and Table A.

Set the body to the fields Table A should receive:

```json
{
  "name": "{{Name}}",
  "email": "{{Email}}",
  "company": "{{Company}}",
  "enriched_title": "{{Job Title}}",
  "enriched_industry": "{{Industry}}"
}
```

Whatever Table B posts in this body becomes the response in Table A's Mold column.

## 7. Test the round trip

Run a row in Table A again:

1. Table A posts the row to Mold.
2. Mold forwards it to Table B with a unique callback URL.
3. Table B runs its processing columns.
4. Table B's final HTTP API column posts the selected result to Mold.
5. Mold returns that result to the waiting row in Table A.

Reference the returned fields in the formulas, routing, enrichment, or activation columns that follow in Table A.

## Optional configuration

| Variable | Default | Purpose |
|---|---:|---|
| `TIMEOUT_MS` | `300000` | Maximum time to wait for Table B's callback |
| `MAX_PENDING` | `100` | Maximum concurrent bridge requests |
| `PORT` | `3000` | Mold's server port |

Mold also limits request bodies to 1 MB and gives the initial forward to Table B 30 seconds to respond.

## Troubleshooting

- **401 Unauthorized:** Confirm both HTTP API columns use `Authorization: Bearer YOUR_API_TOKEN` with the same token configured on Mold.
- **Table B never receives the row:** Check `_mold_target_url`. If the webhook uses authentication, include `_mold_target_auth_token` in Table A's body.
- **Table A times out:** Confirm Table B's final HTTP API column uses `_mold_callback_url`, carries the Mold bearer token, and runs after every processing column.
- **502 from Mold:** Table B's webhook returned an error or could not be reached within 30 seconds.
- **503 from Mold:** The deployment reached `MAX_PENDING`. Wait for current requests to finish or raise the limit on a host with enough memory.
- **Requests fail during a restart:** Pending callbacks exist only in memory and cannot survive a process restart.
- **Callbacks return `unknown`:** The original request already timed out, restarted, or reached another instance.

For more help, [open an issue](https://github.com/eliasstravik/mold/issues).
