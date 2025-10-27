export const WIZARD_STEPS = [
  { id: 'story', title: 'Описание ситуации', caption: 'Расскажите, что произошло и какие цели хотите достичь' },
  {
    id: 'intake',
    title: 'Данные и документы',
    caption: 'Заполните ключевые поля и добавьте подтверждающие материалы'
  },
  { id: 'letter', title: 'Готовое письмо', caption: 'Проверьте черновик и скачайте документ' }
];

export const MODEL_LIBRARY = [
  { id: 'gpt-5', label: 'GPT-5', endpoint: 'responses', supportsJsonSchema: true },
  { id: 'gpt-5-mini', label: 'GPT-5 Mini', endpoint: 'responses', supportsJsonSchema: true },
  { id: 'gpt-5-nano', label: 'GPT-5 Nano', endpoint: 'responses', supportsJsonSchema: true }
];

export const MODEL_OPTIONS = MODEL_LIBRARY.map((model) => model.id);

export const getModelConfig = (modelId) => MODEL_LIBRARY.find((model) => model.id === modelId);

export const isResponsesModel = (modelId) => {
  const model = getModelConfig(modelId);
  return (model?.endpoint || 'responses') === 'responses';
};

export const modelSupportsJsonSchema = (modelId) => {
  const model = getModelConfig(modelId);
  if (!model) {
    return false;
  }
  return Boolean(model.supportsJsonSchema);
};

export const STORAGE_KEYS = {
  theme: 'legal-writer-theme',
  apiKey: 'legal-writer-openai-key',
  gptSettings: 'legal-writer-gpt-settings'
};

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB per file
export const MAX_TOTAL_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB per batch
