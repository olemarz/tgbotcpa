# Telegram operations

## BotFather checklist
- Create the bot and obtain the token (`BOT_TOKEN`).
- Enable inline mode only if required; current flow uses commands and scenes.
- Disable privacy mode if the bot must read messages in group chats for join detection.
- Store the token securely (do not commit to the repository).

## Webhook management
- Webhook endpoint: `https://adspirin.ru${WEBHOOK_PATH:-/bot/webhook}`.
- Set the webhook:
  ```bash
  curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
    -d "url=https://adspirin.ru${WEBHOOK_PATH:-/bot/webhook}" \
    -d 'allowed_updates=["message","callback_query","chat_member","my_chat_member"]'
  ```
- Inspect the current webhook:
  ```bash
  curl "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"
  ```
- Delete the webhook (switch to long polling for debugging):
  ```bash
  curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook"
  ```

## Message formatting
- Default parse mode is plain text; whenever special characters or brackets appear, send messages with `parse_mode: 'HTML'`.
- Escape user-controlled values with HTML helpers (`escapeHtml`) before interpolation.
- Avoid MarkdownV2 unless you escape every reserved character.
- For inline keyboards, HTML parse mode can be used together with `reply_markup` as shown in `handleStartWithToken`.
