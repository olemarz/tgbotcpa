const DEFAULT_TIMEOUT_MS = 5000;

function applyTemplate(template, vars = {}) {
  return Object.entries(vars).reduce((acc, [key, value]) => {
    const encoded = encodeURIComponent(value ?? '');
    return acc.replaceAll(`{${key}}`, encoded);
  }, template);
}

export async function sendPostback({ template, vars }) {
  if (!template || typeof template !== 'string') {
    return { ok: false, status: null, text: 'missing template' };
  }

  const url = applyTemplate(template, vars);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text().catch(() => '');
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    return { ok: false, status: null, text: error?.message || 'request failed' };
  } finally {
    clearTimeout(timeout);
  }
}
