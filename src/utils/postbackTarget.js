import { config } from '../config.js';

const trim = (value) => (typeof value === 'string' ? value.trim() : value);

export function resolvePostbackTarget(offer) {
  const offerUrl = trim(offer?.postback_url);
  if (offerUrl) {
    return offerUrl;
  }

  const configUrl = trim(config?.postback?.url);
  if (configUrl) {
    return configUrl;
  }

  return null;
}

export default resolvePostbackTarget;
