import {
  LEGAL_ANALYSIS_PROMPT,
  LEGAL_PRE_ANALYSIS_PROMPT,
  LEGAL_LAYOUT_PROMPT,
  LEGAL_PRE_SUMMARY_PROMPT
} from './prompts.js';
import {
  ANALYSIS_FLOW_MODES,
  DEFAULT_NEW_BETA_STAGE_SETTINGS,
  NEW_BETA_STAGE_ONE_DEVELOPER_PROMPT,
  NEW_BETA_STAGE_TWO_DEVELOPER_PROMPT
} from './analysisFlowDefaults.js';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses';
const OPENAI_FILES_ENDPOINT = 'https://api.openai.com/v1/files';

const DEFAULT_PROMPT_SETTINGS = Object.freeze({
  preAnalysis: LEGAL_PRE_ANALYSIS_PROMPT,
  summary: LEGAL_PRE_SUMMARY_PROMPT,
  analysis: LEGAL_ANALYSIS_PROMPT,
  layout: LEGAL_LAYOUT_PROMPT
});

const UNIVERSAL_OUTPUT_FORMAT_BLOCK = (() => {
  const marker = '🧾 OUTPUT FORMAT (STRICT):';
  if (typeof LEGAL_ANALYSIS_PROMPT !== 'string') {
    return '';
  }
  const index = LEGAL_ANALYSIS_PROMPT.indexOf(marker);
  if (index === -1) {
    return '';
  }
  return LEGAL_ANALYSIS_PROMPT.slice(index).trim();
})();

const DEFAULT_ANALYSIS_SETTINGS = {
  analysisModel: 'gpt-5-mini',
  preAnalysisModel: 'gpt-5-mini',
  summaryModel: 'gpt-5-mini',
  layoutModel: 'gpt-5-mini',
  preAnalysisWebSearchEnabled: false,
  preAnalysisReasoningEffort: 'medium',
  summaryWebSearchEnabled: false,
  summaryReasoningEffort: 'low',
  analysisWebSearchEnabled: true,
  analysisReasoningEffort: 'medium',
  layoutWebSearchEnabled: false,
  layoutReasoningEffort: 'low',
  developerPromptFromTriage: true,
  localeHint: '',
  prompts: DEFAULT_PROMPT_SETTINGS,
  analysisFlow: ANALYSIS_FLOW_MODES.NEW_BETA,
  newBetaStageOneModel: DEFAULT_NEW_BETA_STAGE_SETTINGS.stageOne.model,
  newBetaStageOneWebSearchEnabled: DEFAULT_NEW_BETA_STAGE_SETTINGS.stageOne.webSearchEnabled,
  newBetaStageOneWebSearchDepth: DEFAULT_NEW_BETA_STAGE_SETTINGS.stageOne.webSearchDepth,
  newBetaStageOneDeveloperPrompt: NEW_BETA_STAGE_ONE_DEVELOPER_PROMPT,
  newBetaStageTwoModel: DEFAULT_NEW_BETA_STAGE_SETTINGS.stageTwo.model,
  newBetaStageTwoWebSearchEnabled: DEFAULT_NEW_BETA_STAGE_SETTINGS.stageTwo.webSearchEnabled,
  newBetaStageTwoWebSearchDepth: DEFAULT_NEW_BETA_STAGE_SETTINGS.stageTwo.webSearchDepth,
  newBetaStageTwoDeveloperPrompt: NEW_BETA_STAGE_TWO_DEVELOPER_PROMPT
};

const MAX_TEXT_CHARS = 120_000;
const MAX_METADATA_VALUE_LENGTH = 500;
const MAX_METADATA_PROPERTIES = 16;
const DEFAULT_LAYOUT_MODEL = 'gpt-5-mini';
const MAX_LAYOUT_INPUT_CHARS = 20_000;
const MAX_LAYOUT_SECTION_ITEMS = Object.freeze({
  card: 8,
  quotes: 12,
  actions: 4,
  actionItems: 6,
  risks: 7,
  redlines: 6,
  notes: 8,
  questions: 7
});

const WEB_SEARCH_TOOL_TYPE = 'web_search';

const sanitizeSearchDepth = (value, fallback = 'medium') => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  return fallback;
};

const sanitizeReasoningEffort = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  return '';
};

const applyWebSearchSettings = ({ payload, enabled, depth, log, scope }) => {
  if (!enabled) {
    return false;
  }
  const searchDepth = sanitizeSearchDepth(depth);
  const tools = Array.isArray(payload.tools) ? [...payload.tools] : [];
  if (!tools.some((tool) => tool?.type === WEB_SEARCH_TOOL_TYPE)) {
    tools.push({ type: WEB_SEARCH_TOOL_TYPE });
  }
  payload.tools = tools;
  if (typeof log === 'function') {
    log({ level: 'debug', message: `Web search enabled (${searchDepth})`, scope });
  }
  return true;
};

const applyReasoningSettings = (payload, effort, { log, scope } = {}) => {
  const normalizedEffort = sanitizeReasoningEffort(effort);
  if (!normalizedEffort) {
    return false;
  }
  payload.reasoning = {
    ...(payload.reasoning || {}),
    effort: normalizedEffort,
    summary: payload.reasoning?.summary || 'auto'
  };
  if (typeof log === 'function') {
    log({ level: 'debug', message: `Reasoning effort: ${normalizedEffort}`, scope });
  }
  return true;
};

const openAiFileCache = new Map();

const formatBytes = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} Б`;
  }
  const units = ['КБ', 'МБ', 'ГБ'];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
};

const base64ToUint8Array = (base64) => {
  if (!base64) return null;
  try {
    if (typeof atob === 'function') {
      const binary = atob(base64);
      const length = binary.length;
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    }
    if (typeof Buffer !== 'undefined') {
      const buffer = Buffer.from(base64, 'base64');
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }
  } catch (error) {
    return null;
  }
  return null;
};

const sanitizeText = (text) => {
  if (!text) return '';
  return String(text)
    .replace(/\u0000/g, ' ')
    .replace(/\s+$/g, '')
    .trim();
};

const hasPromptText = (value) => typeof value === 'string' && value.trim().length > 0;

const mergePromptSettings = (overrides) => {
  const base = { ...DEFAULT_PROMPT_SETTINGS };
  if (overrides && typeof overrides === 'object') {
    if (hasPromptText(overrides.preAnalysis)) {
      base.preAnalysis = overrides.preAnalysis;
    }
    if (hasPromptText(overrides.summary)) {
      base.summary = overrides.summary;
    }
    if (hasPromptText(overrides.analysis)) {
      base.analysis = overrides.analysis;
    }
    if (hasPromptText(overrides.layout)) {
      base.layout = overrides.layout;
    }
  }
  return base;
};

const resolveModelId = (value, fallback) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return fallback;
};

const normalizeInstructionLines = (value) => {
  if (!value) return [];
  const source = Array.isArray(value) ? value : String(value || '')?.split(/\r?\n/);
  if (!Array.isArray(source)) return [];
  return source
    .map((line) => sanitizeText(line).replace(/^[-•]\s*/, ''))
    .filter(Boolean);
};

const formatAsBulletList = (items) => items.map((line) => `- ${line}`).join('\n');

const buildAdaptiveSummaryDirectives = (summary) => {
  if (!summary || typeof summary !== 'object') return [];
  const lines = [];
  if (summary.documentType) {
    lines.push(`Документ классифицирован как «${summary.documentType}» — проверь специфичные требования для этого типа.`);
  }
  if (Array.isArray(summary.parties) && summary.parties.length) {
    lines.push(`Отрази интересы и обязательства сторон: ${summary.parties.join(', ')}.`);
  }
  if (summary.governingLaw) {
    lines.push(`Сопоставь положения с применимым правом: ${summary.governingLaw}.`);
  }
  if (Array.isArray(summary.jurisdictions) && summary.jurisdictions.length) {
    lines.push(`Укажи риски юрисдикций: ${summary.jurisdictions.join(', ')}.`);
  }
  if (Array.isArray(summary.languages) && summary.languages.length) {
    lines.push(`Основной язык анализа: ${summary.languages.join(', ')} — отметь расхождения переводов.`);
  }
  if (Array.isArray(summary.primaryTopics) && summary.primaryTopics.length) {
    lines.push(`В разделах 3 и 4 проработай темы: ${summary.primaryTopics.join(', ')}.`);
  }
  if (Array.isArray(summary.riskFlags) && summary.riskFlags.length) {
    lines.push(`Выдели ключевые риски и последствия: ${summary.riskFlags.join(', ')}.`);
  }
  return lines;
};

const composeAdaptivePromptDisplay = ({ summary, addendumLines, layoutBrief }) => {
  const sections = [];
  const summaryLines = buildAdaptiveSummaryDirectives(summary);
  const normalizedAddendum = normalizeInstructionLines(addendumLines);
  const layoutInstruction = sanitizeText(layoutBrief || '');

  if (summaryLines.length) {
    sections.push(`Контекст документа:\n${formatAsBulletList(summaryLines)}`);
  }
  if (normalizedAddendum.length) {
    sections.push(`Специфические инструкции GPT-5 mini:\n${formatAsBulletList(normalizedAddendum)}`);
  }
  if (layoutInstruction) {
    sections.push(`Подсказка по оформлению отчёта:\n${formatAsBulletList([layoutInstruction])}`);
  }

  return sections.join('\n\n');
};

const composeDeveloperPrompt = ({
  basePrompt,
  summary,
  addendumLines,
  answerLines,
  layoutBrief,
  developerOverride
}) => {
  const contextSections = [];
  const summaryLines = buildAdaptiveSummaryDirectives(summary);
  const normalizedAddendum = normalizeInstructionLines(addendumLines);
  const normalizedAnswers = normalizeInstructionLines(answerLines);
  const layoutInstruction = sanitizeText(layoutBrief || '');
  const overrideText = sanitizeText(developerOverride || '');
  const base = basePrompt || LEGAL_ANALYSIS_PROMPT;

  if (summaryLines.length) {
    contextSections.push(`Контекст документа:\n${formatAsBulletList(summaryLines)}`);
  }
  if (normalizedAddendum.length) {
    contextSections.push(`Специфические инструкции GPT-5 mini:\n${formatAsBulletList(normalizedAddendum)}`);
  }
  if (normalizedAnswers.length) {
    contextSections.push(`Ответы клиента:\n${formatAsBulletList(normalizedAnswers)}`);
  }
  if (layoutInstruction) {
    contextSections.push(`Подсказка по оформлению отчёта:\n${formatAsBulletList([layoutInstruction])}`);
  }

  if (overrideText) {
    const developerSections = [overrideText, ...contextSections];
    return {
      developerText: developerSections.join('\n\n'),
      universalText: UNIVERSAL_OUTPUT_FORMAT_BLOCK
    };
  }

  if (!contextSections.length) {
    return {
      developerText: base,
      universalText: ''
    };
  }

  const promptHeader = '[АДАПТИРОВАННЫЕ УКАЗАНИЯ]';
  return {
    developerText: `${base}\n\n${promptHeader}\n${contextSections.join('\n\n')}`,
    universalText: ''
  };
};

const clampMetadataValue = (value, maxLength = MAX_METADATA_VALUE_LENGTH) => {
  if (value === null || value === undefined) return null;
  const stringValue = String(value);
  if (stringValue.length === 0) return '';
  if (stringValue.length <= maxLength) {
    return stringValue;
  }
  return stringValue.slice(0, maxLength);
};

const normalizeMetadataPreview = (value) => {
  if (!value) return '';
  return String(value)
    .replace(/\s+/g, ' ')
    .trim();
};

const formatMetadataInfo = ({ included, length, preview, extra = [] }) => {
  const parts = [];
  if (typeof included === 'boolean') {
    parts.push(`included=${included ? 'true' : 'false'}`);
  }
  if (Number.isFinite(length)) {
    parts.push(`len=${length}`);
  }
  if (Array.isArray(extra)) {
    for (const item of extra) {
      if (item) {
        parts.push(item);
      }
    }
  }
  const normalizedPreview = normalizeMetadataPreview(preview);
  if (normalizedPreview) {
    parts.push(`preview=${normalizedPreview}`);
  }
  return parts.join('; ');
};

const finalizeMetadataEntries = (entries, { log } = {}) => {
  if (!Array.isArray(entries) || !entries.length) {
    return {};
  }
  const sorted = entries
    .slice()
    .sort((a, b) => {
      const priorityDiff = (a.priority || 0) - (b.priority || 0);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return (a.order || 0) - (b.order || 0);
    });
  const metadata = {};
  const dropped = [];
  for (const entry of sorted) {
    if (Object.prototype.hasOwnProperty.call(metadata, entry.key)) {
      continue;
    }
    if (Object.keys(metadata).length >= MAX_METADATA_PROPERTIES) {
      dropped.push(entry.key);
      continue;
    }
    metadata[entry.key] = entry.value;
  }
  if (dropped.length && typeof log === 'function') {
    log({
      level: 'warn',
      scope: 'openai',
      message: 'Metadata trimmed to satisfy OpenAI property limit',
      droppedMetadataKeys: dropped,
      keptMetadataKeys: Object.keys(metadata)
    });
  }
  return metadata;
};

const splitStringIntoChunks = (value, chunkSize = MAX_METADATA_VALUE_LENGTH) => {
  if (!value) return [];
  const normalized = String(value);
  if (!chunkSize || chunkSize <= 0) {
    return [normalized];
  }
  if (normalized.length <= chunkSize) {
    return [normalized];
  }
  const chunks = [];
  for (let index = 0; index < normalized.length; index += chunkSize) {
    chunks.push(normalized.slice(index, index + chunkSize));
  }
  return chunks;
};

const tryParseJsonObject = (text) => {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    return null;
  }
  return null;
};

const extractFirstJsonObject = (text) => {
  if (!text) return null;
  const direct = tryParseJsonObject(text.trim());
  if (direct) {
    return direct;
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  const candidate = text.slice(firstBrace, lastBrace + 1);
  return tryParseJsonObject(candidate);
};

const prepareDocumentText = (text) => {
  const cleaned = sanitizeText(text);
  if (!cleaned) {
    return { text: '', truncated: false, originalLength: 0 };
  }
  if (cleaned.length <= MAX_TEXT_CHARS) {
    return { text: cleaned, truncated: false, originalLength: cleaned.length };
  }
  const truncatedText = `${cleaned.slice(0, MAX_TEXT_CHARS)}\n\n[... truncated ${cleaned.length - MAX_TEXT_CHARS} characters]`;
  return { text: truncatedText, truncated: true, originalLength: cleaned.length };
};

const resolveAnalysisPrompt = (settings = {}) => {
  const prompts = settings.prompts || {};
  const candidate = hasPromptText(prompts.analysis) ? prompts.analysis : DEFAULT_PROMPT_SETTINGS.analysis;
  return sanitizeText(candidate || '') || LEGAL_ANALYSIS_PROMPT;
};

const sanitizeImageUrl = (value) => {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^data:/i.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const encodedPath = url.pathname
      .split('/')
      .map((segment) => {
        if (!segment) return segment;
        try {
          return encodeURIComponent(decodeURIComponent(segment));
        } catch (error) {
          return encodeURIComponent(segment);
        }
      })
      .join('/');
    url.pathname = encodedPath;
    return url.toString();
  } catch (error) {
    try {
      return encodeURI(trimmed);
    } catch (_) {
      return trimmed;
    }
  }
};

const buildImageParts = (document) => {
  const images = Array.isArray(document?.meta?.pageImages) ? document.meta.pageImages : [];
  return images
    .map((img) => {
      const imageUrl = sanitizeImageUrl(img?.url || img?.secureUrl || '');
      if (!imageUrl) {
        return null;
      }
      return {
        type: 'input_image',
        image_url: imageUrl,
        detail:
          typeof img?.detail === 'string' && img.detail.trim().length ? img.detail : 'low'
      };
    })
    .filter(Boolean);
};

const uploadOriginalDocument = async ({ apiKey, document, log }) => {
  const meta = (document && document.meta) || {};
  const fileBase64 = typeof meta.fileBase64 === 'string' ? meta.fileBase64 : '';
  const hash = meta.hashSha256 || meta.originalSha256 || meta.originalMd5 || '';
  const cached = hash && openAiFileCache.get(hash);
  if (cached?.fileId) {
    if (typeof log === 'function') {
      log({
        level: 'debug',
        message: 'Используем ранее загруженный файл OpenAI',
        scope: 'openai',
        fileId: cached.fileId,
        bytes: cached.bytes || null
      });
    }
    return { ...cached, reused: true };
  }

  const existingId = typeof meta.openaiFileId === 'string' && meta.openaiFileId.trim();
  if (existingId) {
    const reused = {
      fileId: existingId,
      bytes: Number(meta.originalSize) || null,
      fileName: meta.originalName || document?.name || 'document',
      contentType: meta.originalType || 'application/pdf',
      reused: true
    };
    if (hash) {
      openAiFileCache.set(hash, reused);
    }
    return reused;
  }

  if (!fileBase64) {
    return null;
  }

  if (typeof FormData === 'undefined' || typeof Blob === 'undefined') {
    if (typeof log === 'function') {
      log({
        level: 'warn',
        message: 'FormData или Blob недоступны — пропускаем загрузку исходного файла в OpenAI',
        scope: 'openai'
      });
    }
    return null;
  }

  const bytes = base64ToUint8Array(fileBase64);
  if (!bytes || !bytes.length) {
    if (typeof log === 'function') {
      log({
        level: 'warn',
        message: 'Не удалось подготовить данные исходного файла для OpenAI',
        scope: 'openai'
      });
    }
    return null;
  }

  const fileName = meta.originalName || `${document?.name || 'document'}.pdf`;
  const contentType = meta.originalType || 'application/pdf';
  const form = new FormData();
  form.append('purpose', 'assistants');
  form.append('file', new Blob([bytes], { type: contentType }), fileName);

  if (typeof log === 'function') {
    log({
      level: 'info',
      message: 'Загружаем исходный файл в OpenAI',
      scope: 'openai',
      fileName,
      bytes: bytes.length
    });
  }

  const response = await fetch(OPENAI_FILES_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (typeof log === 'function') {
      log({
        level: 'error',
        message: 'Не удалось загрузить исходный файл в OpenAI',
        scope: 'openai',
        status: response.status,
        error: payload?.error?.message || response.statusText
      });
    }
    return null;
  }

  const fileId = typeof payload?.id === 'string' ? payload.id : '';
  if (!fileId) {
    if (typeof log === 'function') {
      log({ level: 'warn', message: 'OpenAI не вернул идентификатор файла', scope: 'openai' });
    }
    return null;
  }

  const uploaded = {
    fileId,
    bytes: bytes.length,
    fileName,
    contentType,
    reused: false
  };

  if (hash) {
    openAiFileCache.set(hash, uploaded);
  }
  if (meta) {
    meta.openaiFileId = fileId;
  }

  if (typeof log === 'function') {
    log({ level: 'info', message: 'Исходный файл загружен в OpenAI', scope: 'openai', fileId });
  }

  return uploaded;
};

const buildDocumentBlock = (document) => {
  const name = document?.name || document?.label || 'Документ';
  const meta = document?.meta || {};
  const { text, truncated, originalLength } = prepareDocumentText(document?.text || document?.plainText || '');
  const headerLines = [
    `Document name: ${name}`,
    meta.originalType ? `Content-Type: ${meta.originalType}` : null,
    meta.originalSize ? `File size: ${meta.originalSize} bytes` : null,
    truncated ? `Note: text truncated to ${MAX_TEXT_CHARS} of ${originalLength} characters` : null
  ].filter(Boolean);
  const header = headerLines.join('\n');
  if (!text) {
    return { block: `${header}\n\nExtracted text is missing. If analysis requires the original file, request OCR or manual upload.`, truncated, originalLength };
  }
  return {
    block: `${header}\n\nExtracted text:\n${text}`,
    truncated,
    originalLength
  };
};

const formatAdaptiveSummary = (summary) => {
  if (!summary || typeof summary !== 'object') return '';
  const lines = [];
  if (summary.documentType) {
    lines.push(`Тип документа: ${summary.documentType}`);
  }
  if (summary.governingLaw) {
    lines.push(`Применимое право: ${summary.governingLaw}`);
  }
  if (Array.isArray(summary.jurisdictions) && summary.jurisdictions.length) {
    lines.push(`Юрисдикции: ${summary.jurisdictions.join(', ')}`);
  }
  if (Array.isArray(summary.languages) && summary.languages.length) {
    lines.push(`Языки: ${summary.languages.join(', ')}`);
  }
  if (Array.isArray(summary.primaryTopics) && summary.primaryTopics.length) {
    lines.push(`Фокус анализа: ${summary.primaryTopics.join(', ')}`);
  }
  if (Array.isArray(summary.riskFlags) && summary.riskFlags.length) {
    lines.push(`Риски: ${summary.riskFlags.join(', ')}`);
  }
  if (!lines.length) return '';
  return `Результаты предварительного анализа:\n${lines.map((line) => `- ${line}`).join('\n')}`;
};

const buildInputMessages = ({
  document,
  userPrompt,
  localeHint,
  developerPromptText,
  universalPromptText,
  imageParts = [],
  fileParts = [],
  ragContext = '',
  attachmentsInfo = [],
  adaptivePromptDisplay = '',
  adaptiveAnswerText = '',
  adaptiveSummary = null,
  adaptiveDeveloperPrompt = '',
  adaptivePromptAddendum = '',
  log
}) => {
  const { block, truncated, originalLength } = buildDocumentBlock(document);
  const pageImages = Array.isArray(document?.meta?.pageImages) ? document.meta.pageImages : [];
  const pageNumbers = pageImages
    .map((img) => (Number.isFinite(Number(img?.page)) ? Number(img.page) : null))
    .filter((page) => Number.isFinite(page))
    .sort((a, b) => a - b);
  const pageCount = Number.isFinite(Number(document?.meta?.pageCount))
    ? Number(document.meta.pageCount)
    : Number.isFinite(Number(document?.meta?.layoutPageCount))
    ? Number(document.meta.layoutPageCount)
    : Number.isFinite(Number(document?.meta?.layout?.summary?.pageCount))
    ? Number(document.meta.layout.summary.pageCount)
    : Array.isArray(document?.meta?.layout?.pages)
    ? document.meta.layout.pages.length
    : Array.isArray(document?.meta?.pages)
    ? document.meta.pages.length
    : 0;
  const expectedPages = pageCount
    ? Array.from({ length: pageCount }, (_, index) => index + 1)
    : [];
  const missingPages = expectedPages.filter((page) => !pageNumbers.includes(page));
  const attachmentLines = attachmentsInfo.filter(Boolean);
  const adaptiveSummaryBlock = formatAdaptiveSummary(adaptiveSummary);
  const supplementary = [
    userPrompt?.trim() ? `Additional instructions from operator:\n${userPrompt.trim()}` : null,
    adaptiveAnswerText ? `Operator responses to adaptive questions:\n${adaptiveAnswerText}` : null,
    localeHint ? `Locale hint: ${localeHint}` : null,
    attachmentLines.length ? `Attachments:\n${attachmentLines.join('\n')}` : null,
    ragContext ? `External legal references prepared via RAG:\n${ragContext}` : null,
    adaptiveSummaryBlock || null,
    block
  ]
    .filter(Boolean)
    .join('\n\n');

  // Никаких truncate/clamp! Только мягкая очистка управляющих символов.
  const sanitizeSoft = (s) =>
    typeof s === 'string'
      ? s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      : '';

  const developerText = [
    adaptiveDeveloperPrompt && `# Adaptive developer prompt\n${sanitizeSoft(adaptiveDeveloperPrompt)}`,
    developerPromptText ? sanitizeSoft(developerPromptText) : LEGAL_ANALYSIS_PROMPT,
    adaptivePromptAddendum && `# Adaptive addendum\n${sanitizeSoft(adaptivePromptAddendum)}`
  ]
    .filter(Boolean)
    .join('\n\n');

  if (typeof log === 'function') {
    log({
      level: 'info',
      scope: 'openai',
      message: 'Developer message prepared',
      developerLen: developerText.length
    });
  }

  if (typeof log === 'function' && developerText.length > 80000) {
    log({
      level: 'warn',
      scope: 'openai',
      message: 'Developer prompt is very large; consider splitting policy into short includes.',
      developerLen: developerText.length
    });
  }
  const universalText = sanitizeText(universalPromptText || '');

  const universalBlock = universalText
    ? `[Универсальный формат отчёта — соблюдай структуру ниже]\n${universalText}`
    : '';

  const finalUserContent = [
    {
      type: 'input_text',
      text: [universalBlock, supplementary].filter(Boolean).join('\n\n')
    },
    ...fileParts,
    ...imageParts
  ];

  const messages = [
    {
      role: 'developer',
      content: [{ type: 'input_text', text: developerText }]
    },
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
            text:
            'Analyze the attached document strictly per the OUTPUT FORMAT. Cite short quotes (≤3 lines) with clause/page references from the document itself. When you need to confirm referenced laws, regulations, or time-sensitive facts, call the web_search tool and list every external source you rely on. If bilingual, use the main legal language. If anything is missing, write: "missing, must be added".'
        }
      ]
    },
    {
      role: 'user',
      content: finalUserContent
    }
  ];

  return {
    messages,
    summary: {
      textIncluded: Boolean(block && block.trim()),
      textTruncated: Boolean(truncated),
      textLength: Number.isFinite(originalLength) ? originalLength : 0,
      attachments: attachmentLines,
      imageCount: pageNumbers.length,
      imagePages: pageNumbers,
      pageCount,
      missingImagePages: missingPages,
      ragContextIncluded: Boolean(ragContext && ragContext.trim()),
      userPromptIncluded: Boolean(userPrompt && userPrompt.trim()),
      localeHintIncluded: Boolean(localeHint && localeHint.trim()),
      adaptiveSummaryIncluded: Boolean(adaptiveSummaryBlock),
      adaptiveAnswersIncluded: Boolean(adaptiveAnswerText),
      adaptivePromptAddendumIncluded: Boolean(adaptivePromptDisplay && adaptivePromptDisplay.trim()),
      imagePartsIncluded: imageParts.length > 0,
      filePartsIncluded: fileParts.length > 0
    }
  };
};

const collectOutputText = (responseJson) => {
  if (!responseJson) return '';
  if (typeof responseJson.output_text === 'string' && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }
  const output = Array.isArray(responseJson.output) ? responseJson.output : [];
  for (const item of output) {
    if (item?.type === 'output_text' && typeof item.text === 'string') {
      return item.text.trim();
    }
    const content = item?.message?.content || item?.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if ((part?.type === 'output_text' || part?.type === 'text') && typeof part?.text === 'string') {
          return part.text.trim();
        }
        if (typeof part === 'string' && part.trim()) {
          return part.trim();
        }
      }
    }
  }
  return '';
};

const extractWebSources = (responseJson) => {
  const collected = [];
  const seen = new Set();

  const pushSource = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const title = sanitizeText(entry.title || entry.name || entry.heading || '');
    const url = sanitizeText(entry.url || entry.link || '');
    const snippet = sanitizeText(entry.snippet || entry.text || entry.description || '');
    const publishedAt = sanitizeText(
      entry.published_at || entry.publishedAt || entry.date || entry.datetime || entry.timestamp || ''
    );

    if (!title && !url && !snippet) {
      return;
    }

    const key = `${url}__${title}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    collected.push({
      title: title || (url ? url.replace(/^https?:\/\//, '') : 'Источник без названия'),
      url: url || '',
      snippet,
      publishedAt
    });
  };

  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== 'object') {
      return;
    }

    if (
      node.type === 'tool_result' &&
      (node.name === 'web_search' || node.name === WEB_SEARCH_TOOL_TYPE)
    ) {
      const items = Array.isArray(node.content) ? node.content : [node.content];
      items.forEach(pushSource);
    }

    Object.values(node).forEach(visit);
  };

  visit(responseJson?.output ?? []);
  visit(responseJson?.content ?? []);
  visit(responseJson?.tool_invocations ?? []);

  return collected.slice(0, 10);
};

const executeRequest = async (apiKey, payload) => {
  const requestBody = JSON.stringify(payload);

  let response;
  try {
    response = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: requestBody
    });
  } catch (error) {
    const message = typeof error?.message === 'string' && error.message.trim()
      ? error.message.trim()
      : 'Неизвестная ошибка сети';
    const hint =
      message === 'Failed to fetch'
        ? 'Проверьте сетевое соединение, настройки прокси/CORS и корректность OPENAI_KEY.'
        : 'Проверьте сетевое соединение и доступность OpenAI API.';
    const enhancedError = new Error(`OpenAI запрос не выполнен: ${message}. ${hint}`);
    enhancedError.cause = error;
    throw enhancedError;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || response.statusText || 'OpenAI request failed';
    throw new Error(`OpenAI ${response.status}: ${message}`);
  }
  return data;
};

const normalizeStringArray = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizeText(item))
    .filter((item) => Boolean(item));
};

const normalizeFollowUpQuestions = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const id = sanitizeText(item.id || item.key || '');
      const question = sanitizeText(item.question || item.text || '');
      if (!id || !question) return null;
      const options = Array.isArray(item.options)
        ? item.options
            .map((option) => {
              if (!option || typeof option !== 'object') return null;
              const optionId = sanitizeText(option.id || option.value || option.key || '');
              const label = sanitizeText(option.label || option.title || '');
              const instruction = sanitizeText(option.instruction || option.result || '');
              if (!optionId || !label) return null;
              return { id: optionId, label, instruction };
            })
            .filter(Boolean)
        : [];
      const allowFreeText = Boolean(item.allow_free_text || item.allowFreeText || item.freeTextAllowed);
      const freeTextHint = sanitizeText(item.free_text_hint || item.freeTextHint || '');
      if (!options.length && !allowFreeText) {
        return null;
      }
      return {
        id,
        question,
        options,
        allowFreeText,
        freeTextHint: freeTextHint || null
      };
    })
    .filter(Boolean)
    .slice(0, 5);
};

const normalizeSummaryPreview = (payload) => {
  const summaryPoints = clampArray(normalizeStringArray(payload?.summary_points), 5);
  const questions = normalizeFollowUpQuestions(payload?.questions);
  const freeText = (() => {
    if (!payload || typeof payload.free_text !== 'object') {
      return null;
    }
    const id = sanitizeText(payload.free_text.id || 'notes');
    const label = sanitizeText(payload.free_text.label || 'Дополнительные комментарии');
    const hint = sanitizeText(payload.free_text.hint || 'Опишите нюансы, которые нужно учесть в анализе.');
    if (!id && !label && !hint) {
      return null;
    }
    return {
      id: id || 'notes',
      label: label || 'Дополнительные комментарии',
      hint: hint || ''
    };
  })();

  return {
    summaryPoints,
    questions,
    freeText
  };
};

const clampArray = (value, limit) => {
  if (!Array.isArray(value) || limit <= 0) return [];
  return value.filter(Boolean).slice(0, limit);
};

const sanitizeLayoutMeta = (meta) => {
  if (!meta || typeof meta !== 'object') return {
    title: '',
    subtitle: '',
    documentName: '',
    preparedFor: '',
    preparedBy: '',
    date: ''
  };
  return {
    title: sanitizeText(meta.title || meta.heading || ''),
    subtitle: sanitizeText(meta.subtitle || meta.subTitle || ''),
    documentName: sanitizeText(meta.documentName || meta.document || ''),
    preparedFor: sanitizeText(meta.preparedFor || meta.client || ''),
    preparedBy: sanitizeText(meta.preparedBy || meta.author || ''),
    date: sanitizeText(meta.date || '')
  };
};

const sanitizeStringArray = (value, limit = 10) => {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .map((item) => sanitizeText(item))
    .filter(Boolean);
  return limit > 0 ? cleaned.slice(0, limit) : cleaned;
};

const sanitizeQuoteArray = (value) => {
  const items = clampArray(value, MAX_LAYOUT_SECTION_ITEMS.quotes);
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const ref = sanitizeText(item.ref || item.reference || item.label || '');
      const text = sanitizeText(item.text || item.quote || '');
      if (!text) return null;
      return { ref, text };
    })
    .filter(Boolean);
};

const sanitizeActionArray = (value) => {
  const blocks = clampArray(value, MAX_LAYOUT_SECTION_ITEMS.actions);
  return blocks
    .map((block) => {
      if (!block || typeof block !== 'object') return null;
      const priority = sanitizeText(block.priority || block.title || '');
      const items = clampArray(block.items, MAX_LAYOUT_SECTION_ITEMS.actionItems)
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const problem = sanitizeText(item.problem || item.issue || '');
          const action = sanitizeText(item.action || item.fix || '');
          const why = sanitizeText(item.why || item.reason || '');
          const refs = sanitizeStringArray(item.refs || item.references || [], 4);
          if (!problem && !action && !why) return null;
          return { problem, action, why, refs };
        })
        .filter(Boolean);
      if (!priority && !items.length) return null;
      return { priority, items };
    })
    .filter(Boolean);
};

const sanitizeRiskArray = (value) => {
  const items = clampArray(value, MAX_LAYOUT_SECTION_ITEMS.risks);
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const title = sanitizeText(item.title || item.name || '');
      const consequence = sanitizeText(item.consequence || item.impact || '');
      const fix = sanitizeText(item.fix || item.mitigation || '');
      const refs = sanitizeStringArray(item.refs || item.references || [], 4);
      const level = sanitizeText(item.level || item.severity || '');
      if (!title && !consequence && !fix) return null;
      return { title, consequence, fix, refs, level };
    })
    .filter(Boolean);
};

const sanitizeRedlinesArray = (value) => {
  const items = clampArray(value, MAX_LAYOUT_SECTION_ITEMS.redlines);
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const current = sanitizeText(item.current || item.original || '');
      const proposal = sanitizeText(item.proposal || item.suggested || '');
      const goal = sanitizeText(item.goal || item.purpose || '');
      if (!current && !proposal) return null;
      return { current, proposal, goal };
    })
    .filter(Boolean);
};

const sanitizeLayoutSections = (sections) => {
  if (!sections || typeof sections !== 'object') {
    return {
      summary: '',
      card: [],
      quotes: [],
      actions: [],
      risks: [],
      redlines: [],
      questions: [],
      readiness: '',
      notes: [],
      source: ''
    };
  }

  return {
    summary: sanitizeText(sections.summary || sections.overview || ''),
    card: sanitizeStringArray(sections.card || sections.documentCard || [], MAX_LAYOUT_SECTION_ITEMS.card),
    quotes: sanitizeQuoteArray(sections.quotes || sections.keyQuotes || []),
    actions: sanitizeActionArray(sections.actions || sections.todo || []),
    risks: sanitizeRiskArray(sections.risks || sections.topRisks || []),
    redlines: sanitizeRedlinesArray(sections.redlines || sections.redLines || []),
    questions: sanitizeStringArray(sections.questions || sections.followUps || [], MAX_LAYOUT_SECTION_ITEMS.questions),
    readiness: sanitizeText(sections.readiness || sections.signoff || ''),
    notes: sanitizeStringArray(sections.notes || sections.remarks || [], MAX_LAYOUT_SECTION_ITEMS.notes),
    source: sanitizeText(sections.source || sections.reference || ''),
    layoutNote: sanitizeText(sections.layoutNote || sections.layout_hint || '')
  };
};

const normalizeLayoutPayload = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return {
      meta: sanitizeLayoutMeta({}),
      sections: sanitizeLayoutSections({}),
      layout: { tone: 'balanced', hint: '' }
    };
  }

  const meta = sanitizeLayoutMeta(payload.meta || {});
  const sections = sanitizeLayoutSections(payload.sections || {});
  const layoutTone = sanitizeText(
    (payload.layout && payload.layout.tone) || payload.tone || sections.tone || ''
  );
  const layoutHint = sanitizeText(
    (payload.layout && payload.layout.hint) || payload.layout_hint || payload.layoutHint || sections.layoutNote || ''
  );

  return {
    meta,
    sections: {
      summary: sections.summary,
      card: sections.card,
      quotes: sections.quotes,
      actions: sections.actions,
      risks: sections.risks,
      redlines: sections.redlines,
      questions: sections.questions,
      readiness: sections.readiness,
      notes: sections.notes,
      source: sections.source
    },
    layout: {
      tone: layoutTone || 'balanced',
      hint: layoutHint
    }
  };
};

const truncateForLayoutModel = (text) => {
  const cleaned = sanitizeText(text);
  if (!cleaned) {
    return { text: '', truncated: false, originalLength: 0 };
  }
  if (cleaned.length <= MAX_LAYOUT_INPUT_CHARS) {
    return { text: cleaned, truncated: false, originalLength: cleaned.length };
  }
  const truncatedTail = cleaned.length - MAX_LAYOUT_INPUT_CHARS;
  const truncatedText = `${cleaned.slice(0, MAX_LAYOUT_INPUT_CHARS)}\n\n[... truncated ${truncatedTail} characters]`;
  return { text: truncatedText, truncated: true, originalLength: cleaned.length };
};

export async function prepareAdaptivePrompt({ apiKey, document, settings = {}, onLog }) {
  if (!apiKey) {
    throw new Error('Укажите API-ключ OpenAI.');
  }
  if (!document) {
    throw new Error('Добавьте документ для адаптивного анализа.');
  }

  const log = (message, level = 'info', extra = {}) => {
    if (typeof onLog === 'function') {
      const entry = typeof message === 'string' ? { message } : { ...message };
      if (!entry.level) entry.level = level;
      if (!entry.at) entry.at = new Date().toISOString();
      Object.assign(entry, extra);
      onLog(entry);
    }
  };

  log({ level: 'info', message: 'Запуск предварительного анализа документа', scope: 'adaptive' });

  const config = {
    ...DEFAULT_ANALYSIS_SETTINGS,
    ...(settings || {})
  };

  config.prompts = mergePromptSettings(settings?.prompts);
  config.preAnalysisModel = resolveModelId(
    config.preAnalysisModel,
    DEFAULT_ANALYSIS_SETTINGS.preAnalysisModel
  );

  const preAnalysisWebSearchEnabled = Boolean(config.preAnalysisWebSearchEnabled);
  const preAnalysisReasoningEffort = config.preAnalysisReasoningEffort || '';

  const imageParts = buildImageParts(document);
  const attachmentsInfo = [];
  const meta = document?.meta || {};
  if (Array.isArray(meta.pageImages) && meta.pageImages.length) {
    const pageNumbers = meta.pageImages
      .map((img) => (Number.isFinite(Number(img?.page)) ? Number(img.page) : null))
      .filter((page) => Number.isFinite(page))
      .sort((a, b) => a - b);
    if (pageNumbers.length) {
      attachmentsInfo.push(
        `Cloudinary page previews (${pageNumbers.length}): страницы ${pageNumbers.join(', ')}`
      );
    }
  }

  let originalFileUpload = null;
  try {
    originalFileUpload = await uploadOriginalDocument({ apiKey, document, log });
    if (originalFileUpload?.fileId) {
      attachmentsInfo.push(
        `Исходный файл загружен в OpenAI (file_id: ${originalFileUpload.fileId}, ${formatBytes(
          originalFileUpload.bytes
        )})`
      );
    }
  } catch (error) {
    log({
      level: 'warn',
      message: error?.message || 'Не удалось загрузить оригинальный файл для адаптивного анализа',
      scope: 'adaptive'
    });
  }

  if (attachmentsInfo.length) {
    const attachmentLines = attachmentsInfo.map((entry) => `• ${entry}`).join('\n');
    log({
      level: 'info',
      message: `В модель переданы вложения:\n${attachmentLines}`,
      scope: 'adaptive',
      attachments: attachmentsInfo
    });
  }

  const fileParts = originalFileUpload?.fileId
    ? [
        {
          type: 'input_file',
          file_id: originalFileUpload.fileId
        }
      ]
    : [];

  const { block, truncated, originalLength } = buildDocumentBlock(document);
  const pageImages = Array.isArray(document?.meta?.pageImages) ? document.meta.pageImages : [];
  const pageNumbers = pageImages
    .map((img) => (Number.isFinite(Number(img?.page)) ? Number(img.page) : null))
    .filter((page) => Number.isFinite(page))
    .sort((a, b) => a - b);
  const pageCount = Number.isFinite(Number(document?.meta?.pageCount))
    ? Number(document.meta.pageCount)
    : Number.isFinite(Number(document?.meta?.layoutPageCount))
    ? Number(document.meta.layoutPageCount)
    : Number.isFinite(Number(document?.meta?.layout?.summary?.pageCount))
    ? Number(document.meta.layout.summary.pageCount)
    : Array.isArray(document?.meta?.layout?.pages)
    ? document.meta.layout.pages.length
    : Array.isArray(document?.meta?.pages)
    ? document.meta.pages.length
    : 0;
  const expectedPages = pageCount ? Array.from({ length: pageCount }, (_, index) => index + 1) : [];
  const missingPages = expectedPages.filter((page) => !pageNumbers.includes(page));

  log({
    level: 'info',
    message: 'Подготовлены данные для предварительного анализа',
    scope: 'adaptive',
    attachments: attachmentsInfo,
    textIncluded: Boolean(block && block.trim()),
    textLength: Number.isFinite(originalLength) ? originalLength : 0,
    textTruncated: Boolean(truncated),
    pageCount,
    imagePages: pageNumbers,
    missingImagePages: missingPages
  });

  const introLocale = sanitizeText(config.localeHint || '');
  const introLines = [
    'Определи тип документа, юрисдикцию, применимое право и ключевые темы.',
    'Подготовь подсказки для уточнения роли клиента и фокуса анализа.'
  ];
  if (introLocale) {
    introLines.push(`Подсказка по языку/юрисдикции: ${introLocale}.`);
  }

  const messages = [
    {
      role: 'developer',
      content: [{ type: 'input_text', text: config.prompts.preAnalysis }]
    },
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: introLines.join(' ')
        }
      ]
    },
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: block
        },
        ...fileParts,
        ...imageParts
      ]
    }
  ];

  const payload = {
    model: config.preAnalysisModel,
    input: messages,
    metadata: {
      purpose: 'adaptive-preanalysis',
      documentName: sanitizeText(document?.name || document?.label || ''),
      localeHint: introLocale
    }
  };

  applyWebSearchSettings({
    payload,
    enabled: preAnalysisWebSearchEnabled,
    depth: preAnalysisWebSearchEnabled ? 'medium' : 'low',
    log,
    scope: 'adaptive'
  });
  applyReasoningSettings(payload, preAnalysisReasoningEffort, { log, scope: 'adaptive' });

  log({
    level: 'info',
    scope: 'adaptive',
    message: `Отправляем запрос в ${config.preAnalysisModel}`,
    model: config.preAnalysisModel,
    webSearch: preAnalysisWebSearchEnabled,
    reasoning: preAnalysisReasoningEffort || 'auto',
    attachments: attachmentsInfo,
    textLength: Number.isFinite(originalLength) ? originalLength : undefined
  });

  const responseJson = await executeRequest(apiKey, payload);
  const outputText = collectOutputText(responseJson);
  log({
    level: 'info',
    scope: 'adaptive',
    message: `Ответ от ${config.preAnalysisModel}`,
    model: config.preAnalysisModel,
    tokens: responseJson?.usage?.total_tokens || null,
    outputPreview: outputText ? outputText.slice(0, 140) : ''
  });
  const parsed = extractFirstJsonObject(outputText);
  if (!parsed) {
    throw new Error('GPT-5 mini не вернул корректный JSON для адаптивного анализа.');
  }

  const developerPrompt = sanitizeText(parsed.developer_prompt || parsed.developerPersona || '');

  const summary = {
    documentType: sanitizeText(parsed.document_type || ''),
    jurisdictions: normalizeStringArray(parsed.jurisdictions),
    governingLaw: sanitizeText(parsed.governing_law || ''),
    parties: normalizeStringArray(parsed.parties),
    languages: normalizeStringArray(parsed.languages),
    primaryTopics: normalizeStringArray(parsed.primary_topics),
    riskFlags: normalizeStringArray(parsed.risk_flags)
  };

  const layoutBrief = sanitizeText(parsed.layout_brief || parsed.layout_hint || '');

  const promptAddendumLines = normalizeInstructionLines(parsed.prompt_addendum);
  const promptAddendum = composeAdaptivePromptDisplay({
    summary,
    addendumLines: promptAddendumLines,
    layoutBrief
  });
  const questions = normalizeFollowUpQuestions(parsed.follow_up_questions);

  log({
    level: 'info',
    message: 'Предварительный анализ завершён',
    scope: 'adaptive',
    summary,
    layoutBrief,
    questions: questions.map((item) => item.id),
    developerPromptLength: developerPrompt.length,
    promptAddendumLength: promptAddendum.length
  });

  return {
    model: 'gpt-5-mini',
    rawText: outputText,
    raw: parsed,
    developerPrompt,
    summary,
    layoutBrief,
    promptAddendum,
    promptAddendumLines,
    questions,
    attachments: attachmentsInfo
  };
}

export async function prepareSummaryPreview({
  apiKey,
  document,
  triage = {},
  settings = {},
  onLog
}) {
  if (!apiKey) {
    throw new Error('Укажите API-ключ OpenAI.');
  }
  if (!document) {
    throw new Error('Документ не найден для предварительного резюме.');
  }

  const log = (message, level = 'info', extra = {}) => {
    if (typeof onLog === 'function') {
      const entry = typeof message === 'string' ? { message } : { ...message };
      entry.level = entry.level || level;
      entry.at = entry.at || new Date().toISOString();
      entry.scope = entry.scope || 'summary';
      Object.assign(entry, extra);
      onLog(entry);
    }
  };

  const config = {
    ...DEFAULT_ANALYSIS_SETTINGS,
    ...(settings || {})
  };

  config.prompts = mergePromptSettings(settings?.prompts);
  config.summaryModel = resolveModelId(
    config.summaryModel,
    DEFAULT_ANALYSIS_SETTINGS.summaryModel
  );

  const summaryPrompt = hasPromptText(config.prompts.summary)
    ? config.prompts.summary
    : LEGAL_PRE_SUMMARY_PROMPT;

  const summaryContext = triage?.summary && typeof triage.summary === 'object' ? triage.summary : {};
  const summaryLines = buildAdaptiveSummaryDirectives(summaryContext);
  const contextSections = [];
  const safeName = sanitizeText(document?.name || document?.label || '');
  if (safeName) {
    contextSections.push(`Документ: ${safeName}`);
  }
  if (summaryLines.length) {
    contextSections.push(`Ключевые факты:\n${formatAsBulletList(summaryLines)}`);
  }

  const { block, truncated, originalLength } = buildDocumentBlock(document);
  const intro = contextSections.join('\n\n');
  const userSections = [];
  if (intro) {
    userSections.push(intro);
  }
  if (block) {
    userSections.push('<<<DOCUMENT>>>');
    userSections.push(block);
    userSections.push('<<<END>>>');
  }

  const payload = {
    model: config.summaryModel,
    input: [
      { role: 'developer', content: [{ type: 'input_text', text: summaryPrompt }] },
      {
        role: 'user',
        content: [{ type: 'input_text', text: userSections.join('\n\n') }]
      }
    ],
    metadata: {
      purpose: 'pre-summary',
      textIncluded: Boolean(block && block.trim()) ? 'true' : 'false',
      textLength: String(originalLength || 0),
      textTruncated: truncated ? 'true' : 'false'
    }
  };

  applyWebSearchSettings({
    payload,
    enabled: Boolean(config.summaryWebSearchEnabled),
    depth: config.summaryWebSearchEnabled ? 'medium' : 'low',
    log,
    scope: 'summary'
  });
  applyReasoningSettings(payload, config.summaryReasoningEffort, { log, scope: 'summary' });

  log({
    level: 'info',
    message: `Отправляем запрос в ${config.summaryModel}`,
    scope: 'summary',
    model: config.summaryModel,
    webSearch: Boolean(config.summaryWebSearchEnabled),
    reasoning: config.summaryReasoningEffort || 'auto',
    textLength: Number.isFinite(originalLength) ? originalLength : undefined,
    truncated
  });

  const responseJson = await executeRequest(apiKey, payload);
  const outputText = collectOutputText(responseJson);
  log({
    level: 'info',
    message: `Ответ от ${config.summaryModel}`,
    scope: 'summary',
    model: config.summaryModel,
    tokens: responseJson?.usage?.total_tokens || null,
    outputPreview: outputText ? outputText.slice(0, 140) : ''
  });
  const parsed = extractFirstJsonObject(outputText);
  if (!parsed) {
    throw new Error('GPT-5 mini не вернул корректный JSON резюме.');
  }

  const normalized = normalizeSummaryPreview(parsed);

  log({
    level: 'info',
    message: 'Резюме подготовлено',
    scope: 'summary',
    points: normalized.summaryPoints.length,
    questions: normalized.questions.map((item) => item.id)
  });

  return {
    model: config.summaryModel,
    rawText: outputText,
    raw: parsed,
    summaryPoints: normalized.summaryPoints,
    questions: normalized.questions,
    freeText: normalized.freeText
  };
}

async function formatReportWithLayoutModel({
  apiKey,
  reportText,
  layoutBrief,
  summary,
  documentName,
  model,
  prompt,
  log,
  webSearchEnabled,
  webSearchDepth,
  reasoningEffort
}) {
  const cleanedReport = sanitizeText(reportText);
  if (!cleanedReport) {
    return null;
  }

  const layoutModel = sanitizeText(model || '') || DEFAULT_LAYOUT_MODEL;
  const truncated = truncateForLayoutModel(cleanedReport);

  if (typeof log === 'function' && truncated.truncated) {
    log({
      level: 'warn',
      message: `Текст отчёта для макета обрезан до лимита модели ${layoutModel}`,
      scope: 'layout',
      originalLength: truncated.originalLength,
      limit: MAX_LAYOUT_INPUT_CHARS
    });
  }

  const summaryLines = buildAdaptiveSummaryDirectives(summary || {});
  const contextParts = [];
  const safeDocumentName = sanitizeText(documentName || '');

  if (safeDocumentName) {
    contextParts.push(`Документ: ${safeDocumentName}`);
  }
  if (layoutBrief) {
    contextParts.push(`Подсказка по стилю: ${layoutBrief}`);
  }
  if (summaryLines.length) {
    contextParts.push(`Контекст анализа:\n${formatAsBulletList(summaryLines)}`);
  }

  const userSections = [];
  if (contextParts.length) {
    userSections.push(contextParts.join('\n\n'));
  }
  userSections.push('Преобразуй отчёт в JSON по указанной схеме без пояснений.');
  userSections.push('<<<REPORT>>>');
  userSections.push(truncated.text);
  userSections.push('<<<END REPORT>>>');

  const layoutPrompt = hasPromptText(prompt) ? prompt : LEGAL_LAYOUT_PROMPT;

  const messages = [
    {
      role: 'developer',
      content: [{ type: 'input_text', text: layoutPrompt }]
    },
    {
      role: 'user',
      content: [{ type: 'input_text', text: userSections.join('\n\n') }]
    }
  ];

  const metadata = {
    purpose: 'report-layout',
    truncated: truncated.truncated ? 'true' : 'false'
  };

  if (safeDocumentName) {
    const clamped = clampMetadataValue(safeDocumentName, 120);
    if (clamped) {
      metadata.documentName = clamped;
    }
  }

  if (layoutBrief) {
    const clamped = clampMetadataValue(layoutBrief, 200);
    if (clamped) {
      metadata.layoutBrief = clamped;
    }
  }

  const payload = {
    model: layoutModel,
    input: messages,
    metadata
  };

  applyWebSearchSettings({
    payload,
    enabled: Boolean(webSearchEnabled),
    depth: webSearchDepth || 'low',
    log,
    scope: 'layout'
  });
  applyReasoningSettings(payload, reasoningEffort, { log, scope: 'layout' });

  if (typeof log === 'function') {
    log({
      level: 'info',
      message: `Отправляем запрос в ${layoutModel}`,
      scope: 'layout',
      model: layoutModel,
      webSearch: Boolean(webSearchEnabled),
      reasoning: reasoningEffort || 'auto',
      truncated: truncated.truncated
    });
  }

  const responseJson = await executeRequest(apiKey, payload);
  const outputText = collectOutputText(responseJson);
  if (typeof log === 'function') {
    log({
      level: 'info',
      message: `Ответ от ${layoutModel}`,
      scope: 'layout',
      model: layoutModel,
      tokens: responseJson?.usage?.total_tokens || null,
      outputPreview: outputText ? outputText.slice(0, 140) : ''
    });
  }
  const parsed = extractFirstJsonObject(outputText);
  if (!parsed) {
    throw new Error(`${layoutModel} не вернул корректный JSON макета отчёта.`);
  }

  const layout = normalizeLayoutPayload(parsed);
  if (typeof log === 'function') {
    log({
      level: 'info',
      message: `Подготовлен макет отчёта ${layoutModel}`,
      scope: 'layout',
      tone: layout?.layout?.tone || 'balanced'
    });
  }

  return {
    model: layoutModel,
    layout,
    usage: responseJson?.usage || null,
    raw: parsed,
    rawText: outputText,
    truncated: truncated.truncated
  };
}

export async function analyzeDocuments({
  apiKey,
  documents = [],
  settings = {},
  userPrompt = '',
  onLog,
  adaptive = null
}) {
  if (!apiKey) {
    throw new Error('Укажите API-ключ OpenAI.');
  }
  if (!documents.length) {
    throw new Error('Добавьте хотя бы один документ для анализа.');
  }

  const log = (message, level = 'info', extra = {}) => {
    if (typeof onLog === 'function') {
      const entry = typeof message === 'string' ? { message } : { ...message };
      if (!entry.level) entry.level = level;
      if (!entry.at) entry.at = new Date().toISOString();
      Object.assign(entry, extra);
      onLog(entry);
    }
  };

  log('Запуск анализа документа', 'info');

  const config = {
    ...DEFAULT_ANALYSIS_SETTINGS,
    ...(settings || {})
  };

  config.prompts = mergePromptSettings(settings?.prompts);
  config.preAnalysisModel = resolveModelId(
    config.preAnalysisModel,
    DEFAULT_ANALYSIS_SETTINGS.preAnalysisModel
  );
  config.summaryModel = resolveModelId(
    config.summaryModel,
    DEFAULT_ANALYSIS_SETTINGS.summaryModel
  );
  config.layoutModel = resolveModelId(
    config.layoutModel,
    DEFAULT_ANALYSIS_SETTINGS.layoutModel
  );
  config.analysisModel = resolveModelId(
    config.analysisModel,
    DEFAULT_ANALYSIS_SETTINGS.analysisModel
  );

  const { localeHint } = config;
  const [document] = documents;
  const baseAnalysisPrompt = resolveAnalysisPrompt(config);
  const model = config.analysisModel;

  const adaptiveInfo = adaptive && typeof adaptive === 'object' ? adaptive : {};
  const adaptiveSummary =
    adaptiveInfo.summary && typeof adaptiveInfo.summary === 'object' ? { ...adaptiveInfo.summary } : null;
  const adaptiveQuestions = Array.isArray(adaptiveInfo.questions) ? adaptiveInfo.questions : [];
  const adaptiveLayoutBrief = sanitizeText(adaptiveInfo.layoutHints || adaptiveInfo.layoutBrief || '');
  const adaptiveDeveloperEnabled = config.developerPromptFromTriage !== false;
  const rawAdaptiveDeveloperPrompt = sanitizeText(
    adaptiveInfo.developerPrompt || adaptiveInfo.developer_prompt || ''
  );
  const adaptiveDeveloperPrompt = adaptiveDeveloperEnabled ? rawAdaptiveDeveloperPrompt : '';
  const adaptivePromptLines = Array.isArray(adaptiveInfo.promptAddendumLines)
    ? adaptiveInfo.promptAddendumLines
    : normalizeInstructionLines(adaptiveInfo.promptAddendum);
  const adaptivePromptAddendum = composeAdaptivePromptDisplay({
    summary: adaptiveSummary,
    addendumLines: adaptivePromptLines,
    layoutBrief: adaptiveLayoutBrief
  });
  const adaptiveAnswerInstructions = Array.isArray(adaptiveInfo.answerInstructions)
    ? adaptiveInfo.answerInstructions.map((item) => sanitizeText(item)).filter(Boolean)
    : normalizeInstructionLines(adaptiveInfo.answerInstructions);
  const adaptiveAnswerText = adaptiveAnswerInstructions.join('\n');

  if (adaptivePromptAddendum) {
    log({ level: 'info', message: 'Используем адаптивное дополнение к промту', scope: 'adaptive' });
  }
  if (adaptiveDeveloperPrompt) {
    log({ level: 'info', message: 'Адаптивный developer-промт получен и применён', scope: 'adaptive' });
  } else if (rawAdaptiveDeveloperPrompt && !adaptiveDeveloperEnabled) {
    log({
      level: 'info',
      message: 'Адаптивный developer-промт получен, но отключён настройками',
      scope: 'adaptive'
    });
  }
  if (adaptiveAnswerText) {
    log({ level: 'info', message: 'Учитываем ответы пользователя на адаптивные вопросы', scope: 'adaptive' });
  }
  if (adaptiveSummary?.documentType) {
    log({
      level: 'info',
      message: `Тип документа по предварительному анализу: ${adaptiveSummary.documentType}`,
      scope: 'adaptive'
    });
  }
  if (adaptiveLayoutBrief) {
    log({ level: 'info', message: `Подсказка по оформлению: ${adaptiveLayoutBrief}`, scope: 'adaptive' });
  }

  const imageParts = buildImageParts(document);
  let originalFileUpload = null;

  const attachmentsInfo = [];
  const meta = document?.meta || {};
  if (Array.isArray(meta.pageImages) && meta.pageImages.length) {
    const pageNumbers = meta.pageImages
      .map((img) => (Number.isFinite(Number(img?.page)) ? Number(img.page) : null))
      .filter((page) => Number.isFinite(page))
      .sort((a, b) => a - b);
    if (pageNumbers.length) {
      attachmentsInfo.push(
        `Cloudinary page previews (${pageNumbers.length}): страницы ${pageNumbers.join(', ')}`
      );
    } else {
      attachmentsInfo.push(`Cloudinary page previews: ${meta.pageImages.length} шт.`);
    }
  }
  if (meta?.cloudinary?.fileUrl) {
    attachmentsInfo.push(`Original file (Cloudinary): ${meta.cloudinary.fileUrl}`);
  }
  if (meta?.cloudinary?.archiveUrl) {
    attachmentsInfo.push(`Archive with page images: ${meta.cloudinary.archiveUrl}`);
  }

  try {
    originalFileUpload = await uploadOriginalDocument({ apiKey, document, log });
  } catch (fileError) {
    log({
      level: 'error',
      message: 'Ошибка загрузки исходного файла в OpenAI',
      scope: 'openai',
      error: fileError?.message || String(fileError)
    });
    originalFileUpload = null;
  }

  if (originalFileUpload?.fileId) {
    const formattedSize = formatBytes(originalFileUpload.bytes);
    const parts = [`file_id ${originalFileUpload.fileId}`];
    if (formattedSize) {
      parts.push(formattedSize);
    }
    attachmentsInfo.push(`Original file uploaded to OpenAI — ${parts.join(', ')}`);
  }

  const ragInfo = { used: false, context: '', references: [], queries: [], hits: [] };

  const fileParts = originalFileUpload?.fileId
    ? [
        {
          type: 'input_file',
          file_id: originalFileUpload.fileId
        }
      ]
    : [];

  const analysisFlow = config.analysisFlow || ANALYSIS_FLOW_MODES.NEW_BETA;
  config.analysisFlow = analysisFlow;
  const isNewBetaFlow = analysisFlow !== ANALYSIS_FLOW_MODES.OLD;

  const stageOneDeveloperOverride =
    sanitizeText(config.newBetaStageOneDeveloperPrompt || '') ||
    DEFAULT_NEW_BETA_STAGE_SETTINGS.stageOne.developerPrompt;

  const developerOverride = isNewBetaFlow
    ? stageOneDeveloperOverride
    : adaptiveDeveloperPrompt;

  const effectivePromptId = isNewBetaFlow
    ? 'new-beta-flow'
    : adaptiveDeveloperPrompt
    ? 'adaptive-developer'
    : 'analysis-base';
  const effectivePromptName = isNewBetaFlow
    ? 'New Beta dual-stage analysis'
    : adaptiveDeveloperPrompt
    ? 'Adaptive developer prompt'
    : 'Base analysis prompt';

  const analysisWebSearchEnabled = Boolean(config.analysisWebSearchEnabled);
  const analysisReasoningEffort = config.analysisReasoningEffort || '';

  const { developerText: developerPromptText, universalText: universalPromptText } = composeDeveloperPrompt({
    basePrompt: baseAnalysisPrompt,
    summary: adaptiveSummary,
    addendumLines: adaptivePromptLines,
    answerLines: adaptiveAnswerInstructions,
    layoutBrief: adaptiveLayoutBrief,
    developerOverride
  });

  const { messages, summary } = buildInputMessages({
    document,
    userPrompt,
    localeHint: localeHint?.trim() || '',
    developerPromptText,
    universalPromptText,
    imageParts,
    fileParts,
    ragContext: '',
    attachmentsInfo,
    adaptiveDeveloperPrompt,
    adaptivePromptAddendum,
    adaptivePromptDisplay: adaptivePromptAddendum,
    adaptiveAnswerText,
    adaptiveSummary,
    log
  });

  if (attachmentsInfo.length) {
    const attachmentLines = attachmentsInfo.map((entry) => `• ${entry}`).join('\n');
    const partSummary = [];
    if (fileParts.length) {
      partSummary.push(
        `input_file: ${fileParts
          .map((part) => (part?.file_id ? String(part.file_id) : '[unknown file_id]'))
          .join(', ')}`
      );
    }
    if (imageParts.length) {
      const pages = Array.isArray(document?.meta?.pageImages)
        ? document.meta.pageImages
            .map((img) => (Number.isFinite(Number(img?.page)) ? Number(img.page) : null))
            .filter((page) => Number.isFinite(page))
            .sort((a, b) => a - b)
        : [];
      const label = pages.length ? `pages ${pages.join(', ')}` : `${imageParts.length} шт.`;
      partSummary.push(`input_image: ${imageParts.length} (${label})`);
    }

    log({
      level: 'info',
      message: `В модель переданы вложения:\n${attachmentLines}`,
      scope: 'openai',
      contentParts: partSummary
    });
  } else {
    log({
      level: 'info',
      message: 'Документ передан без дополнительных вложений',
      scope: 'openai'
    });
  }

  if (summary) {
    const missingPages = Array.isArray(summary.missingImagePages) ? summary.missingImagePages : [];
    const imageInfo = {
      totalPages: summary.pageCount || null,
      imagePages: summary.imagePages || [],
      imageCount: summary.imageCount || 0,
      missingImagePages: missingPages.length ? missingPages : null,
      imagesAttached: Boolean(summary.imagePartsIncluded)
    };
    const textInfo = {
      textIncluded: summary.textIncluded,
      textLength: summary.textLength,
      textTruncated: summary.textTruncated
    };
    log({
      level: 'info',
      message: 'Подготовлены входные данные для анализа',
      scope: 'openai',
      attachments: summary.attachments || [],
      ragContextIncluded: summary.ragContextIncluded,
      userPromptIncluded: summary.userPromptIncluded,
      localeHintIncluded: summary.localeHintIncluded,
      ...textInfo,
      ...imageInfo,
      originalFileUploaded: summary.filePartsIncluded
    });
    if (imageInfo.imageCount && missingPages.length) {
      log({
        level: 'warn',
        message: 'Не для всех страниц сформированы изображения',
        scope: 'openai',
        expectedPages: imageInfo.totalPages,
        presentPages: imageInfo.imagePages,
        missingPages
      });
    }
    if (!imageInfo.imageCount && (imageInfo.totalPages || 0) > 0) {
      log({
        level: 'warn',
        message: 'Изображения страниц отсутствуют и не будут переданы в анализ',
        scope: 'openai'
      });
    }
  }

  const metadataEntries = [];
  const setMetadata = (
    key,
    value,
    { allowEmpty = false, maxLength = MAX_METADATA_VALUE_LENGTH, priority = 0 } = {}
  ) => {
    if (value === null || value === undefined) {
      return;
    }
    const rawString = String(value);
    if (!allowEmpty && !rawString.trim()) {
      return;
    }
    const clamped = clampMetadataValue(rawString, maxLength);
    if (clamped === null) {
      return;
    }
    if (clamped.length < rawString.length && typeof log === 'function') {
      log({
        level: 'warn',
        message: `Metadata поле ${key} обрезано до ${maxLength} символов (лимит OpenAI — 512; превышение вызывает ошибку 400).`,
        scope: 'openai',
        key,
        originalLength: rawString.length,
        truncatedLength: clamped.length
      });
    }
    metadataEntries.push({ key, value: clamped, priority, order: metadataEntries.length });
  };

  setMetadata('promptId', effectivePromptId ?? '', { allowEmpty: true, priority: -2 });
  setMetadata('promptName', effectivePromptName ?? '', { allowEmpty: true, priority: -2 });

  const attachmentsDetail = attachmentsInfo.join('\n');
  const attachmentsIncluded = attachmentsInfo.length > 0;
  const attachmentsSummary = formatMetadataInfo({
    included: attachmentsIncluded,
    length: attachmentsIncluded ? attachmentsDetail.length : undefined,
    preview: attachmentsIncluded ? attachmentsDetail.slice(0, 200) : '',
    extra: attachmentsIncluded ? [`count=${attachmentsInfo.length}`] : []
  });
  if (attachmentsSummary) {
    setMetadata('attachmentsSummary', attachmentsSummary, { allowEmpty: true, priority: -1 });
  }

  setMetadata('ragUsed', String(Boolean(ragInfo.used && ragInfo.context)), { priority: -1 });

  const originalFileUploaded = Boolean(originalFileUpload?.fileId);
  const originalFileSize = Number.isFinite(Number(originalFileUpload?.bytes))
    ? Number(originalFileUpload.bytes)
    : Number.isFinite(Number(meta?.originalSize))
    ? Number(meta.originalSize)
    : null;
  const originalFileInfo = formatMetadataInfo({
    included: originalFileUploaded,
    extra: [
      originalFileUploaded && originalFileUpload.fileId ? `id=${originalFileUpload.fileId}` : null,
      Number.isFinite(originalFileSize) ? `sizeBytes=${originalFileSize}` : null
    ]
  });
  if (originalFileInfo) {
    setMetadata('originalFileInfo', originalFileInfo, { priority: 0 });
  }
  if (adaptiveSummary?.documentType) {
    setMetadata('adaptiveDocumentType', adaptiveSummary.documentType, { priority: 0 });
  }
  if (adaptivePromptAddendum) {
    const preview = adaptivePromptAddendum.slice(0, 200);
    const info = formatMetadataInfo({
      included: true,
      length: adaptivePromptAddendum.length,
      preview,
      extra: []
    });
    setMetadata('adaptivePromptAddendumInfo', info, { priority: 1 });
  }
  if (adaptiveLayoutBrief) {
    const preview = adaptiveLayoutBrief.slice(0, 200);
    const info = formatMetadataInfo({
      included: true,
      length: adaptiveLayoutBrief.length,
      preview
    });
    setMetadata('adaptiveLayoutBriefInfo', info, { priority: 1 });
  }
  if (adaptiveAnswerText) {
    const preview = adaptiveAnswerText.slice(0, 200);
    const info = formatMetadataInfo({
      included: true,
      length: adaptiveAnswerText.length,
      preview
    });
    setMetadata('adaptiveAnswersInfo', info, { priority: 1 });
  }
  if (adaptiveDeveloperPrompt) {
    const preview = adaptiveDeveloperPrompt.slice(0, 200);
    const info = formatMetadataInfo({
      included: true,
      length: adaptiveDeveloperPrompt.length,
      preview
    });
    setMetadata('adaptiveDeveloperPromptInfo', info, { priority: 1 });
  }

  const baseMetadataEntries = metadataEntries.map((entry) => ({ ...entry }));

  if (!isNewBetaFlow) {
    const metadata = finalizeMetadataEntries(baseMetadataEntries, { log });

    const payload = {
      model,
      input: messages,
      metadata
    };

    const webSearchApplied = applyWebSearchSettings({
      payload,
      enabled: analysisWebSearchEnabled,
      depth: analysisWebSearchEnabled ? 'medium' : 'low',
      log,
      scope: 'analysis'
    });
    if (!webSearchApplied) {
      log('Web search отключен для основного анализа', 'debug');
    }
    applyReasoningSettings(payload, analysisReasoningEffort, { log, scope: 'analysis' });

    log({
      level: 'info',
      message: `Отправляем запрос в ${model}`,
      scope: 'analysis',
      model,
      webSearch: Boolean(config.analysisWebSearchEnabled),
      reasoning: analysisReasoningEffort || 'auto',
      attachments: attachmentsInfo,
      adaptivePrompt: Boolean(adaptiveDeveloperPrompt || adaptivePromptAddendum)
    });
    const responseJson = await executeRequest(apiKey, payload);
    const reportText = collectOutputText(responseJson);
    const sources = extractWebSources(responseJson);

    const layoutResult = null;

    log({
      level: 'info',
      message: `Ответ от ${model}`,
      model,
      tokens: responseJson?.usage?.total_tokens || null,
      webSources: sources.length,
      ragUsed: Boolean(ragInfo.used),
      outputPreview: reportText ? reportText.slice(0, 200) : ''
    });

    return {
      reportText,
      model,
      usage: responseJson?.usage || null,
      sources,
      rag: ragInfo,
      prompt: {
        id: effectivePromptId,
        name: effectivePromptName
      },
      adaptive: {
        applied: Boolean(adaptiveDeveloperPrompt || adaptivePromptAddendum || adaptiveAnswerText),
        developerPrompt: adaptiveDeveloperPrompt,
        promptAddendum: adaptivePromptAddendum,
        promptAddendumLines: adaptivePromptLines,
        answerInstructions: adaptiveAnswerInstructions,
        summary: adaptiveSummary,
        layoutBrief: adaptiveLayoutBrief,
        questions: adaptiveQuestions
      },
      layout: layoutResult?.layout || null,
      layoutModel: layoutResult?.model || null,
      raw: responseJson,
      settings: config
    };
  }

  const stageOneMetadata = finalizeMetadataEntries(
    [
      ...baseMetadataEntries,
      {
        key: 'analysisFlow',
        value: ANALYSIS_FLOW_MODES.NEW_BETA,
        priority: -3,
        order: baseMetadataEntries.length
      },
      {
        key: 'analysisStage',
        value: 'initial',
        priority: -3,
        order: baseMetadataEntries.length + 1
      }
    ],
    { log }
  );

  const stageOneModel = resolveModelId(
    config.newBetaStageOneModel,
    DEFAULT_NEW_BETA_STAGE_SETTINGS.stageOne.model
  );
  const stageOneWebSearchEnabled = Boolean(
    config.newBetaStageOneWebSearchEnabled ?? DEFAULT_NEW_BETA_STAGE_SETTINGS.stageOne.webSearchEnabled
  );
  const stageOneWebSearchDepth = sanitizeSearchDepth(
    config.newBetaStageOneWebSearchDepth ?? DEFAULT_NEW_BETA_STAGE_SETTINGS.stageOne.webSearchDepth,
    DEFAULT_NEW_BETA_STAGE_SETTINGS.stageOne.webSearchDepth
  );
  const stageOnePayload = {
    model: stageOneModel,
    input: messages,
    metadata: stageOneMetadata,
    verbosity: 'high',
    summary: 'auto',
    reasoning: { effort: 'high', summary: 'auto' }
  };

  const stageOneWebSearchApplied = applyWebSearchSettings({
    payload: stageOnePayload,
    enabled: stageOneWebSearchEnabled,
    depth: stageOneWebSearchEnabled ? stageOneWebSearchDepth : 'low',
    log,
    scope: 'analysis-stage-1'
  });

  if (!stageOneWebSearchApplied) {
    log('Web search отключен для этапа 1', 'debug');
  }

  log({
    level: 'info',
    message: `Отправляем запрос (этап 1) в ${stageOneModel}`,
    scope: 'analysis',
    model: stageOneModel,
    webSearch: stageOneWebSearchEnabled,
    webSearchDepth: stageOneWebSearchEnabled ? stageOneWebSearchDepth : 'off',
    reasoning: 'high',
    attachments: attachmentsInfo
  });

  const stageOneResponse = await executeRequest(apiKey, stageOnePayload);
  const stageOneReport = collectOutputText(stageOneResponse);

  log({
    level: 'info',
    message: `Ответ получен (этап 1) от ${stageOneModel}`,
    scope: 'analysis',
    model: stageOneModel,
    tokens: stageOneResponse?.usage?.total_tokens || null,
    outputPreview: stageOneReport ? stageOneReport.slice(0, 200) : ''
  });

  const stageTwoOverride =
    sanitizeText(config.newBetaStageTwoDeveloperPrompt || '') ||
    DEFAULT_NEW_BETA_STAGE_SETTINGS.stageTwo.developerPrompt;
  const { developerText: stageTwoDeveloperPromptText, universalText: stageTwoUniversalPromptText } = composeDeveloperPrompt({
    basePrompt: baseAnalysisPrompt,
    summary: adaptiveSummary,
    addendumLines: adaptivePromptLines,
    answerLines: adaptiveAnswerInstructions,
    layoutBrief: adaptiveLayoutBrief,
    developerOverride: stageTwoOverride
  });

  const stageTwoUserPrompt = [
    'Проверь отчёт из первой итерации, усили его, устрани пробелы и подтверди выводы ссылками на документ и внешние источники.',
    '',
    '<<<INITIAL_REPORT>>>',
    stageOneReport || '[initial report missing]',
    '<<<END INITIAL_REPORT>>>'
  ].join('\n');

  const {
    messages: stageTwoMessages,
    summary: stageTwoSummary
  } = buildInputMessages({
    document,
    userPrompt: stageTwoUserPrompt,
    localeHint: localeHint?.trim() || '',
    developerPromptText: stageTwoDeveloperPromptText,
    universalPromptText: stageTwoUniversalPromptText,
    imageParts,
    fileParts,
    ragContext: '',
    attachmentsInfo,
    adaptiveDeveloperPrompt,
    adaptivePromptAddendum,
    adaptivePromptDisplay: adaptivePromptAddendum,
    adaptiveAnswerText,
    adaptiveSummary,
    log
  });

  if (stageTwoSummary) {
    log({
      level: 'info',
      message: 'Подготовлены входные данные для этапа 2',
      scope: 'openai',
      attachments: stageTwoSummary.attachments || [],
      textLength: stageTwoSummary.textLength,
      initialReportIncluded: Boolean(stageOneReport)
    });
  }

  const initialReportInfo = stageOneReport
    ? formatMetadataInfo({
        included: true,
        length: stageOneReport.length,
        preview: stageOneReport.slice(0, 200)
      })
    : '';

  const stageTwoMetadata = finalizeMetadataEntries(
    [
      ...baseMetadataEntries,
      {
        key: 'analysisFlow',
        value: ANALYSIS_FLOW_MODES.NEW_BETA,
        priority: -3,
        order: baseMetadataEntries.length
      },
      {
        key: 'analysisStage',
        value: 'refinement',
        priority: -3,
        order: baseMetadataEntries.length + 1
      },
      initialReportInfo
        ? {
            key: 'initialReportInfo',
            value: initialReportInfo,
            priority: 0,
            order: baseMetadataEntries.length + 2
          }
        : null
    ].filter(Boolean),
    { log }
  );

  const stageTwoModel = resolveModelId(
    config.newBetaStageTwoModel,
    DEFAULT_NEW_BETA_STAGE_SETTINGS.stageTwo.model
  );
  const stageTwoWebSearchEnabled = Boolean(
    config.newBetaStageTwoWebSearchEnabled ?? DEFAULT_NEW_BETA_STAGE_SETTINGS.stageTwo.webSearchEnabled
  );
  const stageTwoWebSearchDepth = sanitizeSearchDepth(
    config.newBetaStageTwoWebSearchDepth ?? DEFAULT_NEW_BETA_STAGE_SETTINGS.stageTwo.webSearchDepth,
    DEFAULT_NEW_BETA_STAGE_SETTINGS.stageTwo.webSearchDepth
  );
  const stageTwoPayload = {
    model: stageTwoModel,
    input: stageTwoMessages,
    metadata: stageTwoMetadata,
    verbosity: 'high',
    summary: 'auto',
    reasoning: { effort: 'high', summary: 'auto' }
  };

  applyWebSearchSettings({
    payload: stageTwoPayload,
    enabled: stageTwoWebSearchEnabled,
    depth: stageTwoWebSearchEnabled ? stageTwoWebSearchDepth : 'low',
    log,
    scope: 'analysis-stage-2'
  });

  log({
    level: 'info',
    message: `Отправляем запрос (этап 2) в ${stageTwoModel}`,
    scope: 'analysis',
    model: stageTwoModel,
    webSearch: stageTwoWebSearchEnabled,
    webSearchDepth: stageTwoWebSearchEnabled ? stageTwoWebSearchDepth : 'off',
    reasoning: 'high',
    attachments: attachmentsInfo,
    initialReportPreview: stageOneReport ? stageOneReport.slice(0, 200) : ''
  });

  const stageTwoResponse = await executeRequest(apiKey, stageTwoPayload);
  const finalReportText = collectOutputText(stageTwoResponse);
  const finalSources = extractWebSources(stageTwoResponse);

  log({
    level: 'info',
    message: `Ответ получен (этап 2) от ${stageTwoModel}`,
    scope: 'analysis',
    model: stageTwoModel,
    tokens: stageTwoResponse?.usage?.total_tokens || null,
    webSources: finalSources.length,
    outputPreview: finalReportText ? finalReportText.slice(0, 200) : ''
  });

  return {
    reportText: finalReportText,
    model: stageTwoModel,
    usage: stageTwoResponse?.usage || null,
    sources: finalSources,
    rag: ragInfo,
    prompt: {
      id: effectivePromptId,
      name: effectivePromptName
    },
    adaptive: {
      applied: Boolean(adaptiveDeveloperPrompt || adaptivePromptAddendum || adaptiveAnswerText),
      developerPrompt: adaptiveDeveloperPrompt,
      promptAddendum: adaptivePromptAddendum,
      promptAddendumLines: adaptivePromptLines,
      answerInstructions: adaptiveAnswerInstructions,
      summary: adaptiveSummary,
      layoutBrief: adaptiveLayoutBrief,
      questions: adaptiveQuestions
    },
    layout: null,
    layoutModel: null,
    raw: stageTwoResponse,
    settings: config,
    stages: {
      initial: {
        model: stageOneModel,
        usage: stageOneResponse?.usage || null,
        reportText: stageOneReport,
        raw: stageOneResponse
      }
    }
  };
}

export async function formatAnalysisLayout({
  apiKey,
  reportText,
  documentName = '',
  layoutBrief = '',
  summary = null,
  settings = {},
  onLog
}) {
  if (!apiKey) {
    throw new Error('Укажите API-ключ OpenAI.');
  }
  const cleanedReport = sanitizeText(reportText);
  if (!cleanedReport) {
    throw new Error('Нет текста отчёта для форматирования.');
  }

  const log = (message, level = 'info', extra = {}) => {
    if (typeof onLog === 'function') {
      const entry = typeof message === 'string' ? { message } : { ...message };
      entry.level = entry.level || level;
      entry.at = entry.at || new Date().toISOString();
      entry.scope = entry.scope || 'layout';
      Object.assign(entry, extra);
      onLog(entry);
    }
  };

  const config = {
    ...DEFAULT_ANALYSIS_SETTINGS,
    ...(settings || {})
  };
  config.prompts = mergePromptSettings(settings?.prompts);
  config.layoutModel = resolveModelId(
    config.layoutModel,
    DEFAULT_ANALYSIS_SETTINGS.layoutModel
  );

  log({ level: 'info', message: 'Формируем оформленный отчёт', scope: 'layout' });

  const result = await formatReportWithLayoutModel({
    apiKey,
    reportText: cleanedReport,
    layoutBrief,
    summary,
    documentName,
    model: config.layoutModel,
    prompt: config.prompts.layout,
    log,
    webSearchEnabled: Boolean(config.layoutWebSearchEnabled),
    webSearchDepth: config.layoutWebSearchEnabled ? 'medium' : 'low',
    reasoningEffort: config.layoutReasoningEffort
  });

  return result;
}
