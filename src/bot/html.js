// src/bot/html.js
export function sanitizeTelegramHtml(input) {
  if (input == null) return '';
  let s = String(input);

  // 0) Нормализуем любые <br>, <br/> к \n (в HTML parse_mode Telegram перенос — это \n)
  s = s.replace(/<\s*br\s*\/?>/gi, '\n');

  // 1) НИЧЕГО не трогаем с \n — оставляем переносы строк как есть

  // 2) Экраним всё
  s = s.replace(/&/g, '&amp;')
       .replace(/</g, '&lt;')
       .replace(/>/g, '&gt;');

  // 3) Разрешаем только поддерживаемые Telegram HTML теги (БЕЗ br!)
  // b,strong,i,em,u,s,a,code,pre,blockquote (спойлер/стили не трогаем)
  s = s.replace(
    /&lt;(\/?(?:b|strong|i|em|u|s|a|code|pre|blockquote)\b[^&]*)&gt;/gi,
    '<$1>'
  );

  return s;
}

export async function replyHtml(ctx, html, extra = {}) {
  const safe = sanitizeTelegramHtml(String(html));
  return ctx.reply(safe, { parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}

const html = { sanitizeTelegramHtml, replyHtml };
export default html;
