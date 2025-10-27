import { useEffect, useState } from 'react';
import { STORAGE_KEYS } from '../lib/config.js';
import { readStoredValue, writeStoredValue } from '../lib/storage.js';

export const useApiKey = () => {
  const [apiKey, setApiKey] = useState(() => readStoredValue(STORAGE_KEYS.apiKey, ''));

  useEffect(() => {
    if (apiKey) {
      writeStoredValue(STORAGE_KEYS.apiKey, apiKey);
    }
  }, [apiKey]);

  return { apiKey, setApiKey };
};
