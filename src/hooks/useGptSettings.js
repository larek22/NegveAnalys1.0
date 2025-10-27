import { useCallback, useState } from 'react';
import { STORAGE_KEYS } from '../lib/config.js';
import { getDefaultGptSettings } from '../lib/fallbacks.js';
import { readStoredJson, writeStoredValue } from '../lib/storage.js';

const mergeSettings = (storedSettings) => {
  const defaults = getDefaultGptSettings();
  if (!storedSettings || typeof storedSettings !== 'object') {
    return defaults;
  }

  const storedAnalysis = { ...(storedSettings.analysis || {}) };

  if (!storedAnalysis.preAnalysisModel && storedAnalysis.triageModel) {
    storedAnalysis.preAnalysisModel = storedAnalysis.triageModel;
  }
  if (storedAnalysis.preAnalysisWebSearchEnabled === undefined && storedAnalysis.triageWebSearchEnabled !== undefined) {
    storedAnalysis.preAnalysisWebSearchEnabled = storedAnalysis.triageWebSearchEnabled;
  }
  if (!storedAnalysis.preAnalysisReasoningEffort && storedAnalysis.triageReasoningEffort) {
    storedAnalysis.preAnalysisReasoningEffort = storedAnalysis.triageReasoningEffort;
  }

  return {
    analysis: {
      ...defaults.analysis,
      ...storedAnalysis,
      prompts: {
        ...defaults.analysis.prompts,
        ...(storedAnalysis.prompts || {})
      },
      cloudinary: {
        ...defaults.analysis.cloudinary,
        ...(storedAnalysis.cloudinary || {})
      }
    }
  };
};

export const useGptSettings = () => {
  const [gptSettings, setGptSettings] = useState(() => mergeSettings(readStoredJson(STORAGE_KEYS.gptSettings, null)));

  const persist = useCallback((updater) => {
    setGptSettings((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      writeStoredValue(STORAGE_KEYS.gptSettings, next);
      return next;
    });
  }, []);

  const updateSetting = useCallback(
    (group, key, value) => {
      persist((prev) => ({
        ...prev,
        [group]: {
          ...prev[group],
          [key]: value
        }
      }));
    },
    [persist]
  );

  const resetSettings = useCallback(() => {
    const defaults = getDefaultGptSettings();
    persist(defaults);
  }, [persist]);

  return { gptSettings, setGptSettings: persist, updateSetting, resetSettings };
};
