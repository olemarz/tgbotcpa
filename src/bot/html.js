const WL = /&lt;(\/?(?:b|i|u|a|code|pre)(?:\s+[^&>]*)?)&gt;/gi;

export function sanitizeTelegramHtml(input) {
  if (input === null || input === undefined) return '';

  let s;
  if (typeof input === 'string') {
    s = input;
  } else if (typeof input.toString === 'function') {
    s = input.toString();
  } else {
    s = String(input);
  }

  s = s.replace(/\r?\n/g, '\n');
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(WL, '<$1>');
  s = s.replace(/<\/?br\s*\/?>(?:\n)?/gi, '\n');
  return s;
}

export async function replyHtml(ctx, html, extra = {}) {
  let value = html;
  if (typeof value !== 'string') {
    if (value === null || value === undefined) value = '';
    else if (Array.isArray(value)) value = value.join('\n');
    else if (typeof value.toString === 'function') value = value.toString();
    else value = String(value);
  }

  const safe = sanitizeTelegramHtml(value);
  return ctx.reply(safe, { parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}
