const TELEGRAM_HOSTS = new Set(['t.me', 'telegram.me', 'telegram.dog']);

function getMessageText(message) {
  if (!message) return '';
  if (typeof message.text === 'string') return message.text;
  if (typeof message.caption === 'string') return message.caption;
  return '';
}

function findUrlEntity(message) {
  if (!message) return null;
  const entities = Array.isArray(message.entities)
    ? message.entities
    : Array.isArray(message.caption_entities)
      ? message.caption_entities
      : [];
  return entities.find((entity) => entity?.type === 'url') || null;
}

function sliceEntityText(text, entity) {
  if (!entity) return '';
  const start = Math.max(0, entity.offset || 0);
  const end = start + (entity.length || 0);
  return text.slice(start, end);
}

export function extractUrlFromMessage(message) {
  const text = getMessageText(message);
  if (!text) return null;
  const entity = findUrlEntity(message);
  if (!entity) return null;
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
  parsed.pathname = normalizedPath.endsWith('/') && normalizedPath !== '/' ? normalizedPath.slice(0, -1) : normalizedPath;

  return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}${parsed.search}`;
}

export function createLinkCaptureMiddleware(handler) {
  if (typeof handler !== 'function') {
    throw new TypeError('handler must be a function');
  }

  return async function linkCaptureMiddleware(ctx, next) {
    if (!ctx?.message) {
      return next();
    }

    if (ctx.scene?.current) {
      return next();
    }

    const text = getMessageText(ctx.message);
    if (typeof text === 'string' && text.trimStart().startsWith('/')) {
      return next();
    }

    const hasUrlEntity = Boolean(findUrlEntity(ctx.message));
    if (!hasUrlEntity) {
      return next();
    }

    const session = ctx.session || {};
    const expecting = session.mode === 'offer:create' && session.awaiting === 'target_link';
    if (!expecting) {
      return next();
    }

    return handler(ctx, next);
  };
}

export async function handleTargetLinkCapture(ctx, next) {
  const rawUrl = extractUrlFromMessage(ctx.message);
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
}

