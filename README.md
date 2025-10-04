# Telegram Tracking MVP (Node.js + Telegraf)

Minimal MVP to track Telegram join/reaction/comment/poll/share events and send postbacks with `click_id` to a CPA network.

## Quick start (VPS + PM2)

1. Install Node 20, Git, PM2.
2. Create Postgres DB (Neon/ElephantSQL or local).
3. `cp .env.example .env` and fill values.
4. `npm i`
5. `npm run migrate`
6. `pm2 start ecosystem.config.js && pm2 save`
7. Expose `PORT` via Nginx or Cloudflare Tunnel and set Telegram webhook:
   ```bash
   curl -X POST "https://api.telegram.org/bot$BOT_TOKEN/setWebhook"      -d "url=$BASE_URL/bot/webhook"      -d 'allowed_updates=["chat_member","chat_join_request","message_reaction","message_reaction_count","poll_answer","message","channel_post","pre_checkout_query","successful_payment"]'
   ```

## Endpoints
- `GET /click/:offerId` → creates token & redirects to `t.me/Bot?start=<token>`
- `GET /s/:shareToken` → counts unique share click & redirects
- `POST /postbacks/relay` → accept external postbacks (e.g., from advertiser's bot) and attribute by `user_id`

## Notes
- This is an MVP scaffold. Review and harden before production.
