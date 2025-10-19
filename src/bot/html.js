const WL = /<(\/?(?:b|i|u|a|code|pre|br)(?:\s+[^>]*)?\/?)/gi;

export function sanitizeTelegramHtml(input) {
  if (!input) return '';
  let s = String(input);
  s = s.replace(/\r?\n/g, '<br/>');
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/&lt;br\s*\/??&gt;/gi, '<br/>');
  s = s.replace(
    /&lt;(\/?)(b|i|u|a|code|pre)(\s+[^&>]*)?&gt;/gi,
    (_, slash = '', tag = '', attrs = '') => `<${slash}${tag}${attrs || ''}>`,
  );
  return s;
}

export async function replyHtml(ctx, html, extra = {}) {
  const safe = sanitizeTelegramHtml(String(html));
  return ctx.reply(safe, { parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}
