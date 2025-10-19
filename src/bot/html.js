const WL = /<(?:\/?(?:b|strong|i|em|u|s|strike|del|a|code|pre|br)\b[^>]*)>/gi;

export function sanitizeTelegramHtml(input) {
  if (!input) return '';
  let s = String(input);
  s = s.replace(/\r?\n/g, '<br>');
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/&lt;(\/?(?:b|strong|i|em|u|s|strike|del|a|code|pre|br)\b[^&]*)&gt;/gi, '<$1>');
  s = s.replace(/(?:<br>\s*){3,}/g, '<br><br>');
  return s;
}

export async function replyHtml(ctx, html, extra = {}) {
  const safe = sanitizeTelegramHtml(String(html));
  return ctx.reply(safe, { parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}
