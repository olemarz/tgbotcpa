// Единый безопасный HTML-рендер под Telegram, без внешних зависимостей.
const WL = /<(?:\/?(?:b|strong|i|em|u|s|strike|del|a|code|pre|br)\b[^>]*)>/gi;

export function sanitizeTelegramHtml(input) {
  if (!input) return '';
  let s = String(input);

  // \n → <br>
  s = s.replace(/\r?\n/g, '<br>');

  // экранирование
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // вернуть whitelist-теги
  s = s.replace(/&lt;(\/?(?:b|strong|i|em|u|s|strike|del|a|code|pre|br)\b[^&]*)&gt;/gi, '<$1>');

  // максимум два переноса подряд
  s = s.replace(/(?:<br>\s*){3,}/g, '<br><br>');

  return s;
}

export async function replyHtml(ctx, html, extra = {}) {
  const safe = sanitizeTelegramHtml(String(html));
  return ctx.reply(safe, { parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}
