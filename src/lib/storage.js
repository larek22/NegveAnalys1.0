const getStorage = () => {
  try {
    if (typeof window === 'undefined') return null;
    if (!window?.localStorage) return null;
    return window.localStorage;
  } catch (error) {
    return null;
  }
};

export const readStoredJson = (key, fallback) => {
  const storage = getStorage();
  if (!storage) return fallback;

  try {
    const stored = storage.getItem(key);
    if (!stored) return fallback;
    return JSON.parse(stored);
  } catch (error) {
    return fallback;
  }
};

export const readStoredValue = (key, fallback) => {
  const storage = getStorage();
  if (!storage) return fallback;

  try {
    const stored = storage.getItem(key);
    return stored ?? fallback;
  } catch (error) {
    return fallback;
  }
};

export const writeStoredValue = (key, value) => {
  const storage = getStorage();
  if (!storage) return;

  try {
    if (value !== undefined && value !== null && value !== '') {
      storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    } else {
      storage.removeItem(key);
    }
  } catch (error) {
    // ignore storage errors
  }
};

const CACHE_PREFIX = 'anDoc:cache:';

export const makeAnalysisCacheKey = ({ hash, model, mode, schemaVersion, signature }) => {
  if (!hash || !model || !mode || !schemaVersion) return null;
  const suffix = signature ? `:${signature}` : '';
  return `${CACHE_PREFIX}${hash}:${model}:${mode}:${schemaVersion}${suffix}`;
};

export const readAnalysisCache = (key) => {
  if (!key) return null;
  return readStoredJson(key, null);
};

export const writeAnalysisCache = (key, value) => {
  if (!key) return;
  writeStoredValue(key, value);
};
