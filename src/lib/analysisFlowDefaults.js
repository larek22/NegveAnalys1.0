export const ANALYSIS_FLOW_MODES = Object.freeze({
  OLD: 'old',
  NEW_BETA: 'new-beta'
});

export const NEW_BETA_STAGE_ONE_DEVELOPER_PROMPT =
  'ты очень опытная юридическая компания, изучи документ, пойми его юрисдикцию и стороны и сделай глубокий анализ документа и напиши мне ТОЛЬКО очень сильный и всеобъемлющий отчёт/анализ сделанный профессиональной юридической компанией с 20 летней практикой в сфере работы с такими документами';

export const NEW_BETA_STAGE_TWO_DEVELOPER_PROMPT =
  'Вы очень опытная Юридическая Компания вам нужно проверить отчёт по документу и сам документ, усилить его(отчет), исправить в нем слабые стороны, добавить то что упущено и нахватает анализе и вернуть полностью исправленный, доработанный, усиленный, Суперпрофессиональный отчёт(анализ) от сильнейшей юридической компании в этой юрисдикции';

export const DEFAULT_NEW_BETA_STAGE_SETTINGS = Object.freeze({
  stageOne: Object.freeze({
    model: 'gpt-5-mini',
    webSearchEnabled: false,
    webSearchDepth: 'medium',
    developerPrompt: NEW_BETA_STAGE_ONE_DEVELOPER_PROMPT
  }),
  stageTwo: Object.freeze({
    model: 'gpt-5',
    webSearchEnabled: true,
    webSearchDepth: 'high',
    developerPrompt: NEW_BETA_STAGE_TWO_DEVELOPER_PROMPT
  })
});
