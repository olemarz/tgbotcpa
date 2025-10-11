function normalizeCountry(country) {
  if (!country) {
    return null;
  }
  const trimmed = String(country).trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.toUpperCase();
}

function normalizeGeoList(list) {
  if (!list) {
    return [];
  }
  if (Array.isArray(list)) {
    return list
      .map((item) => String(item || '').trim().toUpperCase())
      .filter((item) => item.length > 0);
  }

  if (typeof list === 'string') {
    const trimmed = list.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item || '').trim().toUpperCase())
          .filter((item) => item.length > 0);
      }
    } catch (_error) {
      // ignore JSON parse errors — fall back to comma/space separated parsing
    }

    return trimmed
      .split(/[\s,;]+/)
      .map((item) => item.trim().toUpperCase())
      .filter((item) => item.length > 0);
  }

  return [];
}

function normalizeGeoMode(mode) {
  if (!mode) {
    return 'any';
  }
  return String(mode).trim().toLowerCase();
}

export function isAllowedByGeo(country, mode, list) {
  const normalizedCountry = normalizeCountry(country);
  const normalizedList = normalizeGeoList(list);
  const normalizedMode = normalizeGeoMode(mode);

  if (normalizedMode === 'disabled' || normalizedMode === 'off' || normalizedMode === 'any') {
    return true;
  }

  if (!normalizedList.length) {
    return true;
  }

  if (normalizedMode === 'allow' || normalizedMode === 'whitelist' || normalizedMode === 'include') {
    if (!normalizedCountry) {
      return false;
    }
    return normalizedList.includes(normalizedCountry);
  }

  if (normalizedMode === 'deny' || normalizedMode === 'blacklist' || normalizedMode === 'exclude') {
    if (!normalizedCountry) {
      return true;
    }
    return !normalizedList.includes(normalizedCountry);
  }

  return true;
}

export function checkGeoAccess(country, mode, list, context) {
  const allowed = isAllowedByGeo(country, mode, list);
  return {
    allowed,
    context: {
      ...context,
      country: normalizeCountry(country),
      mode,
      list,
    },
  };
}
