// src/bot/html.js
// Единый безопасный HTML-рендер под ограничения Telegram.
// Без сторонних зависимостей.

const ALLOWED = /<(?:\/?(?:b|strong|i|em|u|s|strike|del|a|code|pre|br)\b[^>]*)>/gi;

export function sanitizeTelegramHtml(input) {
  if (!input) return '';
  let s = String(input);

  // Превращаем переводы строк в <br> (удобнее писать \n в коде)
  s = s.replace(/\r?\n/g, '<br>');

  // Экранируем спецсимволы
  s = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Возвращаем допустимые теги (упрощённый подход: только whitelist)
  s = s.replace(/&lt;(\/?(?:b|strong|i|em|u|s|strike|del|a|code|pre|br)\b[^&]*)&gt;/gi, '<$1>');

  // Чистим вложенность <br> (2+ в ряд → 2)
  s = s.replace(/(?:<br>\s*){3,}/g, '<br><br>');

  return s;
}

export async function replyHtml(ctx, html, extra = {}) {
  const input = Array.isArray(html) ? html.join('\n') : html;
  const safe = sanitizeTelegramHtml(input);
  const options = {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra
  };
  return ctx.reply(safe, options);
}
