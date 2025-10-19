// src/bot/html.js
export function sanitizeTelegramHtml(input) {
  if (input == null) return '';
  let s = String(input);

  // 1) переносы — пишем в коде \n, тут превращаем в <br>
  s = s.replace(/\r?\n/g, '<br>');

  // 2) экранируем всё
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 3) разрешаем подмножество HTML-тегов обратно (без самозакрывающих br/)
  s = s.replace(/&lt;(\/?(?:b|strong|i|em|u|s|a|code|pre|br)\b[^&]*)&gt;/gi, '<$1>');

  // 4) нормализуем ошибочные <br/> или <br /> в <br>
  s = s.replace(/<br\s*\/>/gi, '<br>');

  return s;
}

export async function replyHtml(ctx, html, extra = {}) {
  const safe = sanitizeTelegramHtml(String(html));
  return ctx.reply(safe, { parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}

// опционально, чтобы старые импорты default тоже не ломались
const html = { sanitizeTelegramHtml, replyHtml };
export default html;
