import {
  LEGAL_ANALYSIS_PROMPT,
  LEGAL_LAYOUT_PROMPT,
  LEGAL_PRE_ANALYSIS_PROMPT,
  LEGAL_PRE_SUMMARY_PROMPT
} from './prompts.js';

export const getDefaultGptSettings = () => {
  return {
    analysis: {
      preAnalysisModel: 'gpt-5-mini',
      preAnalysisWebSearchEnabled: false,
      preAnalysisReasoningEffort: 'medium',
      summaryModel: 'gpt-5-mini',
      summaryWebSearchEnabled: false,
      summaryReasoningEffort: 'low',
      analysisModel: 'gpt-5-mini',
      analysisWebSearchEnabled: true,
      analysisReasoningEffort: 'medium',
      layoutModel: 'gpt-5-mini',
      layoutWebSearchEnabled: false,
      layoutReasoningEffort: 'low',
      developerPromptFromTriage: true,
      analysisFlow: 'new-beta',
      localeHint: '',
      prompts: {
        preAnalysis: LEGAL_PRE_ANALYSIS_PROMPT,
        summary: LEGAL_PRE_SUMMARY_PROMPT,
        analysis: LEGAL_ANALYSIS_PROMPT,
        layout: LEGAL_LAYOUT_PROMPT
      },
      cloudinary: {
        cloudName: '',
        uploadPreset: '',
        folder: '',
        apiKey: '',
        apiSecret: '',
        archivePreset: '',
        resourceType: 'auto',
        pageImageScale: 2,
        maxPageImages: 40,
        pageImageFormat: 'png',
        pageImageQuality: 'auto:eco',
        pageImageTransformation: '',
        deliveryType: 'upload',
        uploadOriginalFile: false
      }
    }
  };
};
