# WhatsApp relay for LIVE STUDIO

WhatsApp only delivers incoming messages to a public web address (a webhook). LIVE STUDIO runs on
your own computer, so this small relay receives them and keeps them until the app pulls them.
It stores only the sender's number and the text, in a short queue that empties as the app reads it.

## What you need

- A Meta developer app with the WhatsApp product (developers.facebook.com): the **Phone number ID**
  of the business number, a **long-lived access token**, and the app's **App secret**.
- A Vercel account and an **Upstash Redis** database (Vercel Marketplace → Upstash → Redis, free tier).

## Deploy

1. Deploy this folder to Vercel (New Project → import, root directory `relay/whatsapp`).
2. Environment variables in the Vercel project:
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`: from Upstash (added automatically by the integration).
   - `WA_VERIFY_TOKEN`: any word you choose, typed again in Meta's webhook form.
   - `WA_APP_SECRET`: the Meta app's App secret (used to check that messages really come from Meta).
   - `RELAY_SECRET`: a long random string (24+ characters). The same string goes into LIVE STUDIO.
3. In Meta → WhatsApp → Configuration → Webhook: callback URL `https://<your-relay>.vercel.app/api/webhook`,
   verify token = `WA_VERIFY_TOKEN`, then subscribe to **messages**.

## In LIVE STUDIO

Settings → Kết nối → WhatsApp: your WhatsApp number (with country code), the Phone number ID, the relay
address `https://<your-relay>.vercel.app`, the access token and `RELAY_SECRET`. Turn it on and press
"Gửi thử". Only messages from your own number are passed to the AI team.
