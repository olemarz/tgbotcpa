const DEFAULT_TIMEOUT_MS = 5000;

type PostbackTemplateVars = {
  offer_id: string;
  tg_id: number | string;
  click_id?: string | number | null;
  amount_cents?: number | string | null;
};

type SendPostbackArgs = {
  template: string | null | undefined;
  vars?: PostbackTemplateVars;
};

type SendPostbackResult = {
  ok: boolean;
  status: number | null;
  text: string;
};

function applyTemplate(template: string, vars: PostbackTemplateVars = { offer_id: '', tg_id: '' }) {
  return Object.entries(vars).reduce((acc, [key, value]) => {
    const encoded = encodeURIComponent(value ?? '');
    return acc.replaceAll(`{${key}}`, encoded);
  }, template);
}

export async function sendPostback({ template, vars = { offer_id: '', tg_id: '' } }: SendPostbackArgs): Promise<SendPostbackResult> {
  if (!template || typeof template !== 'string') {
    return { ok: false, status: null, text: 'missing template' };
  }

  const url = applyTemplate(template, vars);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal, method: 'GET' });
    const text = await response.text().catch(() => '');
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'request failed';
    return { ok: false, status: null, text: message };
  } finally {
    clearTimeout(timeout);
  }
}

export type { PostbackTemplateVars, SendPostbackArgs, SendPostbackResult };
