const TELEGRAM_HOSTS = new Set(['t.me', 'telegram.me', 'telegram.dog']);

function getMessageText(message) {
  if (!message) return '';
  if (typeof message.text === 'string') return message.text;
  if (typeof message.caption === 'string') return message.caption;
  return '';
}

function getMessageEntities(message) {
  if (!message) return [];
  if (Array.isArray(message.entities)) {
    return message.entities;
  }
  if (Array.isArray(message.caption_entities)) {
    return message.caption_entities;
  }
  return [];
}

function findLinkEntity(message) {
  const entities = getMessageEntities(message);
  return (
    entities.find((entity) => entity?.type === 'url' || entity?.type === 'text_link') ||
    null
  );
}

function sliceEntityText(text, entity) {
  if (!entity) return '';
  const start = Math.max(0, entity.offset || 0);
  const end = start + (entity.length || 0);
  return text.slice(start, end);
}

export function extractUrlFromMessage(message) {
  const entity = findLinkEntity(message);
  if (!entity) return null;

  if (entity.type === 'text_link' && typeof entity.url === 'string') {
    const value = entity.url.trim();
    return value || null;
  }

  const text = getMessageText(message);
  if (!text) return null;
  const value = sliceEntityText(text, entity).trim();
  return value || null;
}

export function normalizeTelegramLink(rawUrl) {
  if (!rawUrl) return null;
  let candidate = rawUrl.trim();
  if (!candidate) return null;

  if (!/^[a-z]+:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (error) {
    return null;
  }

  if (!TELEGRAM_HOSTS.has(parsed.hostname.toLowerCase())) {
    return null;
  }

  parsed.protocol = 'https:';
  parsed.hash = '';
  const normalizedPath = parsed.pathname.replace(/\/{2,}/g, '/');
  parsed.pathname =
    normalizedPath.endsWith('/') && normalizedPath !== '/' ? normalizedPath.slice(0, -1) : normalizedPath;

  return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}${parsed.search}`;
}

export function createLinkCaptureMiddleware() {
  return async function linkCaptureMiddleware(ctx, next) {
    if (process.env.DISABLE_LINK_CAPTURE === 'true') {
      return next();
    }

    const text = ctx.message?.text ?? '';
    if (text.startsWith('/')) {
      return next();
    }

    const session = ctx.session ?? {};
    const expecting = session.mode === 'offer:create' && session.awaiting === 'target_link';
    if (!expecting) {
      return next();
    }

    const message = ctx?.update?.message ?? ctx?.message;
    if (!message) {
      return next();
    }

    const normalizedText = getMessageText(message);
    if (typeof normalizedText === 'string' && normalizedText.trimStart().startsWith('/')) {
      return next();
    }

    const entities = getMessageEntities(message);
    const hasUrlEntity = entities.some((entity) => entity?.type === 'url' || entity?.type === 'text_link');
    if (!hasUrlEntity) {
      return next();
    }

    const rawUrl = extractUrlFromMessage(message);
    if (!rawUrl) {
      return next();
    }

    const normalized = normalizeTelegramLink(rawUrl);
    if (!normalized) {
      if (typeof ctx.reply === 'function') {
        await ctx.reply('Нужно прислать ссылку вида https://t.me/...');
      }
      return next();
    }

    if (!ctx.session) {
      ctx.session = {};
    }

    ctx.session.target_link = normalized;
    ctx.session.raw_target_link = rawUrl;

    return next();
  };
}

