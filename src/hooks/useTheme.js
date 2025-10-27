import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEYS } from '../lib/config.js';
import { readStoredValue, writeStoredValue } from '../lib/storage.js';

const themeClass = (theme) => (theme === 'dark' ? 'dark' : 'light');

export const useTheme = () => {
  const [theme, setTheme] = useState(() => readStoredValue(STORAGE_KEYS.theme, 'light'));

  useEffect(() => {
    document.documentElement.dataset.theme = themeClass(theme);
    writeStoredValue(STORAGE_KEYS.theme, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, setTheme, toggleTheme };
};

export const getThemeClass = themeClass;
