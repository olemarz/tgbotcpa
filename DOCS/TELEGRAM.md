# Telegram operations

## BotFather checklist

- Create the bot and obtain the token (`BOT_TOKEN`).
- Set an explicit username (`BOT_USERNAME`) to generate deep links.
- Disable privacy mode if group joins must be tracked (`/setprivacy -> Disable`).
- Rotate the token immediately if it leaks; update `.env` and redeploy.

## Webhook management

- Webhook endpoint: `${PUBLIC_BASE_URL}${WEBHOOK_PATH:-/bot/webhook}` (served by `src/api/server.js`).
- Set or refresh the webhook:
  ```bash
  curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
    -d "url=${PUBLIC_BASE_URL}${WEBHOOK_PATH:-/bot/webhook}" \
    -d 'allowed_updates=["message","callback_query","chat_member","my_chat_member"]' \
    -d "secret_token=${WEBHOOK_SECRET}"
  ```
- Inspect the current webhook:
  ```bash
  curl "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"
  ```
- Delete the webhook (switch to long polling):
  ```bash
  curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook"
  ```
- For local debugging run `npm run bot` to enable polling instead of webhooks.

## Message formatting & safety

- Default parse mode is HTML; sanitize user input via `sanitizeTelegramHtml` (`src/bot/telegraf.js`).
- Use `ctx.replyWithHTML`/`replyHtml` helpers when inserting bold text, links or code blocks.
- Escape deep link payloads with `encodeURIComponent` before embedding into `/start` commands.
- Keep inline keyboards compact; Telegram truncates buttons beyond 8 columns or ~100 characters.
- Monitor `bot.catch` logs (registered in `src/bot/telegraf.js`) for rate limits or malformed payloads.
