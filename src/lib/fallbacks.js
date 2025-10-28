import {
  LEGAL_ANALYSIS_PROMPT,
  LEGAL_LAYOUT_PROMPT,
  LEGAL_PRE_ANALYSIS_PROMPT,
  LEGAL_PRE_SUMMARY_PROMPT
} from './prompts.js';
import {
  DEFAULT_NEW_BETA_STAGE_SETTINGS,
  NEW_BETA_STAGE_ONE_DEVELOPER_PROMPT,
  NEW_BETA_STAGE_TWO_DEVELOPER_PROMPT
} from './analysisFlowDefaults.js';

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
      newBetaStageOneModel: DEFAULT_NEW_BETA_STAGE_SETTINGS.stageOne.model,
      newBetaStageOneWebSearchEnabled: DEFAULT_NEW_BETA_STAGE_SETTINGS.stageOne.webSearchEnabled,
      newBetaStageOneWebSearchDepth: DEFAULT_NEW_BETA_STAGE_SETTINGS.stageOne.webSearchDepth,
      newBetaStageOneDeveloperPrompt: NEW_BETA_STAGE_ONE_DEVELOPER_PROMPT,
      newBetaStageTwoModel: DEFAULT_NEW_BETA_STAGE_SETTINGS.stageTwo.model,
      newBetaStageTwoWebSearchEnabled: DEFAULT_NEW_BETA_STAGE_SETTINGS.stageTwo.webSearchEnabled,
      newBetaStageTwoWebSearchDepth: DEFAULT_NEW_BETA_STAGE_SETTINGS.stageTwo.webSearchDepth,
      newBetaStageTwoDeveloperPrompt: NEW_BETA_STAGE_TWO_DEVELOPER_PROMPT,
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
