import { uploadDataUrlToCloudinary } from './cloudinary.js';

/*
 * Document handling utilities
 *
 * This module is rebuilt from scratch to provide a predictable, traceable
 * extraction pipeline for PDFs, DOCX files and plain text uploads.  The goal
 * is to keep the public API identical (readFileContent, trimSnippet, etc.)
 * while simplifying the internal flow so we can reason about every step.
 */

let pdfjsPromise;
let jszipPromise;
let ocrScriptPromise;

const MIN_USEFUL_TEXT_LENGTH = 200;
const IMAGE_PREVIEW_MAX_CHARS = 2800;
const OCR_QUALITY_THRESHOLD = 0.12;

const nowIso = () => new Date().toISOString();

const pushTrace = (trace, step, detail, status = 'info') => {
  trace.push({ step, detail, status, at: nowIso() });
};

const toArrayBuffer = async (value) => {
  if (!value) return null;
  if (value instanceof ArrayBuffer) {
    try {
      return value.slice(0);
    } catch (error) {
      throw new Error('Не удалось скопировать содержимое файла', { cause: error });
    }
  }
  if (ArrayBuffer.isView(value)) {
    try {
      return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    } catch (error) {
      throw new Error('Не удалось прочитать содержимое файла', { cause: error });
    }
  }
  if (value?.arrayBuffer) {
    const result = await value.arrayBuffer();
    return toArrayBuffer(result);
  }
  throw new Error('Неподдерживаемый формат буфера файла');
};

const cloneArrayBuffer = (buffer) => {
  if (!buffer) return null;
  try {
    if (buffer instanceof ArrayBuffer) {
      return buffer.slice(0);
    }
    if (ArrayBuffer.isView(buffer)) {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
  } catch (error) {
    // если slice не сработал из-за отсоединённого буфера — продолжим
  }

  try {
    const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const copy = new Uint8Array(view.length);
    copy.set(view);
    return copy.buffer;
  } catch (error) {
    return null;
  }
};

const readAsArrayBuffer = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.onload = () => resolve(reader.result);
    reader.readAsArrayBuffer(file);
  });

const readAsDataURL = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });

const arrayBufferToBase64 = (buffer) => {
  if (!buffer) return '';
  try {
    const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < view.length; i += chunk) {
      binary += String.fromCharCode(...view.subarray(i, i + chunk));
    }
    if (typeof btoa === 'function') {
      return btoa(binary);
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(binary, 'binary').toString('base64');
    }
    return '';
  } catch (error) {
    throw new Error('Не удалось преобразовать файл в Base64', { cause: error });
  }
};

const computeSha256 = async (buffer) => {
  if (!buffer) return null;
  try {
    if (typeof crypto !== 'undefined' && crypto?.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      const bytes = Array.from(new Uint8Array(digest));
      return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    if (typeof globalThis !== 'undefined' && typeof globalThis.Buffer !== 'undefined') {
      const { createHash } = await import('crypto');
      const hash = createHash('sha256');
      hash.update(Buffer.from(buffer));
      return hash.digest('hex');
    }
  } catch (error) {
    // ignore hashing errors
  }
  return null;
};

const resolvePdfWorkerSrc = async (pdfjs) => {
  if (typeof window === 'undefined') return;
  const options = pdfjs.GlobalWorkerOptions || pdfjs?.pdfjsLib?.GlobalWorkerOptions;
  if (!options) return;
  if (options.workerSrc) return;
  let workerSrc = '';
  try {
    const workerModule = await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url');
    workerSrc = workerModule?.default || workerModule;
  } catch (error) {
    const version = pdfjs.version || pdfjs?.pdfjsLib?.version || '5.4.296';
    workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.js`;
    console.warn('[documents] fallback pdf.js workerSrc', error);
  }
  if (workerSrc) {
    options.workerSrc = workerSrc;
  }
};

const loadPdfjs = async () => {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then(async (mod) => {
      await resolvePdfWorkerSrc(mod);
      return mod;
    });
  }
  return pdfjsPromise;
};

const loadJSZip = async () => {
  if (!jszipPromise) {
    jszipPromise = import('jszip').then((mod) => mod.default || mod);
  }
  return jszipPromise;
};

const canUseCanvas = () => {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    return Boolean(ctx);
  } catch (error) {
    return false;
  }
};

const loadTesseract = async () => {
  if (!canUseCanvas()) return null;
  if (typeof window === 'undefined') return null;
  if (window.Tesseract) return window.Tesseract;
  if (!ocrScriptPromise) {
    ocrScriptPromise = new Promise((resolve) => {
      const existing = document.querySelector('script[data-ocr-loader="true"]');
      if (existing) {
        existing.addEventListener(
          'load',
          () => resolve(window.Tesseract || null),
          { once: true }
        );
        existing.addEventListener('error', () => resolve(null), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
      script.dataset.ocrLoader = 'true';
      script.onload = () => resolve(window.Tesseract || null);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
  }
  return ocrScriptPromise;
};

const MAX_PAGE_IMAGES = 40;
const PAGE_IMAGE_SCALE = 2;

const sanitizePublicId = (value) => {
  if (!value || typeof value !== 'string') {
    return `document-${Date.now()}`;
  }
  const cleaned = value
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || `document-${Date.now()}`;
};

const encodeCloudinaryPublicId = (publicId = '') =>
  publicId
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

const buildCloudinaryDeliveryUrl = ({
  cloudName,
  resourceType = 'image',
  deliveryType = 'upload',
  publicId,
  transformation
}) => {
  if (!cloudName || !publicId) return '';
  const normalizedResource = resourceType === 'raw' ? 'image' : resourceType || 'image';
  const safeType = deliveryType && typeof deliveryType === 'string' ? deliveryType : 'upload';
  const base = `https://res.cloudinary.com/${cloudName}/${normalizedResource}/${safeType}`;
  const trimmedTransformation = transformation ? transformation.replace(/^\/+|\/+$/g, '') : '';
  const transformationPart = trimmedTransformation ? `${trimmedTransformation}/` : '';
  const encodedId = encodeCloudinaryPublicId(publicId);
  return `${base}/${transformationPart}${encodedId}`;
};

const buildCloudinaryPagePreviewUrls = ({
  cloudName,
  publicId,
  resourceType = 'image',
  deliveryType = 'upload',
  pageCount = 0,
  format = 'png',
  quality = 'auto:eco',
  customTransformation
}) => {
  const totalPages = Number.isFinite(pageCount) && pageCount > 0 ? pageCount : 0;
  if (!cloudName || !publicId || !totalPages) return [];

  const urls = [];
  for (let page = 1; page <= totalPages; page += 1) {
    let transformation = '';
    if (typeof customTransformation === 'string' && customTransformation.trim()) {
      const sanitized = customTransformation.trim().replace('{page}', String(page));
      transformation = sanitized;
    } else {
      const parts = [];
      if (format) {
        parts.push(`f_${format}`);
      }
      parts.push(`pg_${page}`);
      if (quality) {
        parts.push(`q_${quality}`);
      }
      transformation = parts.join(',');
    }

    const url = buildCloudinaryDeliveryUrl({
      cloudName,
      resourceType,
      deliveryType,
      publicId,
      transformation
    });

    if (url) {
      urls.push({ page, url, transformation });
    }
  }

  return urls;
};

const resolveCloudinaryResourceType = (mime = '', config = {}) => {
  if (config && config.resourceType && config.resourceType !== 'auto') {
    return config.resourceType;
  }
  if (typeof mime === 'string' && /pdf$/i.test(mime)) {
    return 'image';
  }
  return config?.resourceType || 'auto';
};

const base64ToDataUrl = (base64, mime) => {
  if (!base64) return '';
  const safeMime = mime && typeof mime === 'string' ? mime : 'application/octet-stream';
  return `data:${safeMime};base64,${base64}`;
};

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Cannot read blob'));
    reader.readAsDataURL(blob);
  });

const renderPdfPageImages = async (buffer, { scale = PAGE_IMAGE_SCALE, maxPages = MAX_PAGE_IMAGES, log } = {}) => {
  let typedArray;
  try {
    typedArray = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  } catch (error) {
    if (typeof log === 'function') {
      log('Не удалось подготовить данные для генерации изображений', 'warn', {
        scope: 'cloudinary',
        error: error?.message || String(error)
      });
    }
    return [];
  }
  const createCanvasBundle = async (width, height) => {
    if (typeof document !== 'undefined' && document?.createElement) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      const toDataUrl = async () => canvas.toDataURL('image/png');
      const cleanup = () => {
        canvas.width = 0;
        canvas.height = 0;
      };
      return { canvas, context, toDataUrl, cleanup };
    }
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      const toDataUrl = async () => {
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        return blobToDataUrl(blob);
      };
      const cleanup = () => {
        canvas.width = 0;
        canvas.height = 0;
      };
      return { canvas, context, toDataUrl, cleanup };
    }
    return null;
  };

  const canvasCheck = await createCanvasBundle(1, 1);
  if (!canvasCheck || !canvasCheck.context) {
    if (typeof log === 'function') {
      log('Canvas недоступен, пропускаем генерацию изображений', 'warn', { scope: 'cloudinary' });
    }
    return [];
  }
  canvasCheck.cleanup?.();

  try {
    const pdfjs = await loadPdfjs();
    const pdfDoc = await pdfjs.getDocument({ data: typedArray, disableWorker: true }).promise;
    const images = [];

    for (let pageIndex = 1; pageIndex <= pdfDoc.numPages && pageIndex <= maxPages; pageIndex += 1) {
      const page = await pdfDoc.getPage(pageIndex);
      const viewport = page.getViewport({ scale });
      const bundle = await createCanvasBundle(viewport.width, viewport.height);

      if (!bundle || !bundle.context) {
        page.cleanup?.();
        continue;
      }

      await page.render({ canvasContext: bundle.context, viewport }).promise;
      const dataUrl = await bundle.toDataUrl();
      images.push({
        page: pageIndex,
        dataUrl,
        width: viewport.width,
        height: viewport.height
      });
      bundle.cleanup?.();
      page.cleanup?.();
    }

    pdfDoc.cleanup?.();

    if (typeof log === 'function') {
      log(`Сгенерированы изображения страниц (${images.length})`, 'info', { scope: 'cloudinary' });
    }

    return images;
  } catch (error) {
    if (typeof log === 'function') {
      log('Не удалось создать изображения страниц', 'warn', {
        scope: 'cloudinary',
        error: error?.message || String(error),
        stack: error?.stack || null
      });
    }
    return [];
  }
};

const uploadPageImages = async ({ images, baseName, config, log }) => {
  if (!Array.isArray(images) || !images.length) {
    return [];
  }
  const uploaded = [];
  for (const image of images) {
    const upload = await uploadDataUrlToCloudinary({
      dataUrl: image.dataUrl,
      fileName: `${sanitizePublicId(baseName || 'document')}-page-${String(image.page).padStart(3, '0')}`,
      config,
      log,
      resourceType: 'image',
      tags: ['document-page']
    });
    if (upload?.url) {
      uploaded.push({
        page: image.page,
        url: upload.url,
        width: image.width,
        height: image.height,
        publicId: upload.publicId || null
      });
    }
  }
  return uploaded;
};

export const createPdfPageImages = (buffer, options) => renderPdfPageImages(buffer, options);

export const testCloudinaryPagePreviews = async ({
  buffer,
  fileName,
  config,
  scale,
  maxPages,
  log
}) => {
  if (!config || !config.cloudName) {
    throw new Error('Укажите корректные настройки Cloudinary.');
  }
  const images = await renderPdfPageImages(buffer, { scale, maxPages, log });
  if (!images.length) {
    throw new Error('Не удалось создать изображения страниц.');
  }
  const uploaded = await uploadPageImages({ images, baseName: fileName, config, log });
  if (!uploaded.length) {
    throw new Error('Не удалось загрузить изображения страниц.');
  }
  return {
    generated: images.length,
    uploaded: uploaded.length,
    uploadedPages: uploaded
  };
};

const createPageArchiveDataUrl = async (images, baseName) => {
  if (!Array.isArray(images) || !images.length) {
    return null;
  }
  try {
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    images.forEach((image) => {
      const base64 = typeof image.dataUrl === 'string' ? image.dataUrl.split(',')[1] : '';
      if (!base64) return;
      const fileName = `page_${String(image.page).padStart(3, '0')}.png`;
      zip.file(fileName, base64, { base64: true });
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const dataUrl = await blobToDataUrl(blob);
    return { dataUrl, fileName: `${sanitizePublicId(baseName || 'document')}-pages` };
  } catch (error) {
    return null;
  }
};

const resolveApiBase = () => {
  if (typeof window !== 'undefined') {
    if (window.__API_BASE__) {
      return String(window.__API_BASE__);
    }
    if (window.__APP_API_BASE__) {
      return String(window.__APP_API_BASE__);
    }
  }

  if (typeof globalThis !== 'undefined') {
    const { __API_BASE__: globalApiBase, __APP_API_BASE__: appApiBase } = globalThis;
    if (globalApiBase) {
      return String(globalApiBase);
    }
    if (appApiBase) {
      return String(appApiBase);
    }
    const processEnv = typeof globalThis.process !== 'undefined' ? globalThis.process.env || {} : {};
    if (processEnv.VITE_API_BASE) {
      return String(processEnv.VITE_API_BASE);
    }
    if (processEnv.API_BASE_URL) {
      return String(processEnv.API_BASE_URL);
    }
    if (processEnv.API_BASE) {
      return String(processEnv.API_BASE);
    }
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    const origin = window.location.origin;
    if (/localhost|127\.0\.0\.1/.test(origin)) {
      return origin.replace(/:\d+$/, ':8000');
    }
    return origin;
  }

  return 'http://localhost:8000';
};

const detectFileKind = (file, buffer) => {
  const name = (file?.name || '').toLowerCase();
  const type = (file?.type || '').toLowerCase();
  const view = new Uint8Array(buffer.slice(0, 8));

  if (type.includes('pdf') || name.endsWith('.pdf') || (view[0] === 0x25 && view[1] === 0x50)) {
    return 'pdf';
  }
  if (name.endsWith('.docx') || type.includes('wordprocessingml') || (view[0] === 0x50 && view[1] === 0x4b)) {
    return 'docx';
  }
  if (type.startsWith('text/') || name.match(/\.(txt|md|csv|json|log)$/)) {
    return 'text';
  }
  if (type.startsWith('image/')) {
    return 'image';
  }
  return 'binary';
};

const decodeUsing = (buffer, encoding, options = {}) => {
  let decoder = null;

  if (typeof TextDecoder !== 'undefined') {
    try {
      decoder = new TextDecoder(encoding, { fatal: false, ...options });
    } catch (error) {
      decoder = null;
    }
  }

  if (!decoder && typeof require === 'function') {
    try {
      const { TextDecoder: NodeTextDecoder } = require('util');
      decoder = new NodeTextDecoder(encoding, { fatal: false, ...options });
    } catch (error) {
      decoder = null;
    }
  }

  if (!decoder) return '';

  try {
    return decoder.decode(buffer);
  } catch (error) {
    return '';
  }
};

export const decodeTextBuffer = (buffer) => {
  if (!buffer) return '';
  const strictUtf8 = decodeUsing(buffer, 'utf-8', { fatal: true });
  if (strictUtf8) {
    return strictUtf8;
  }
  const candidates = [
    'utf-8',
    'utf-16le',
    'utf-16be',
    'windows-1251',
    'koi8-r',
    'ibm866'
  ];
  let best = { score: -Infinity, text: '' };
  for (const encoding of candidates) {
    const text = decodeUsing(buffer, encoding);
    if (!text) continue;
    const score = scoreTextCandidate(text);
    if (score > best.score) {
      best = { score, text };
    }
  }
  return best.text;
};

const scoreTextCandidate = (text) => {
  if (!text) return -Infinity;
  const cleaned = text.replace(/\s+/g, ' ');
  const length = cleaned.length;
  if (!length) return -Infinity;
  const cyrillic = (cleaned.match(/[А-Яа-яЁё]/g) || []).length;
  const mojibake = (cleaned.match(/[ÃÂÐÑÒÓÝæ]/g) || []).length;
  const controls = (cleaned.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  return length / 50 + cyrillic * 0.6 - mojibake * 4 - controls * 6;
};

export const trimSnippet = (text, limit = 2000) => {
  if (!text) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
};

const computeQuality = (text) => {
  if (!text) return 0;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 0;
  const cyrillic = (cleaned.match(/[А-Яа-яЁё]/g) || []).length;
  const lengthScore = Math.min(1, cleaned.length / 4000);
  const cyrillicScore = Math.min(0.6, cyrillic / Math.max(cleaned.length, 1));
  return Number((lengthScore + cyrillicScore).toFixed(3));
};

const normalizePageSegments = (segments, fallbackText = '') => {
  if (Array.isArray(segments) && segments.length) {
    const cleaned = segments
      .map((segment) => (typeof segment === 'string' ? segment.replace(/\s+/g, ' ').trim() : ''))
      .filter(Boolean);
    if (cleaned.length) {
      return cleaned;
    }
  }
  const fallback = (fallbackText || '').replace(/\s+/g, ' ').trim();
  return fallback ? [fallback] : [];
};

const buildPageTaggedText = (pages) => {
  if (!Array.isArray(pages) || !pages.length) return '';
  return pages
    .map((pageText, index) => `<<<PAGE ${index + 1}>>>\n${pageText}`)
    .join('\n\n');
};

const buildPageMeta = (text, pagesInput, layout, languages) => {
  const layoutPageCount = layout?.summary?.pageCount
    || (Array.isArray(layout?.pages) ? layout.pages.length : 0);
  const pages = normalizePageSegments(pagesInput, text);
  const effectivePageCount = pages.length || layoutPageCount || 0;
  const languageHints = Array.isArray(languages) && languages.length
    ? languages
    : pages.map(detectLanguageFromText);
  const meta = {
    pages,
    pageCount: effectivePageCount,
    pageTaggedText: buildPageTaggedText(pages),
    languages: languageHints,
    layoutPageCount
  };
  if (layout && typeof layout === 'object') {
    meta.layout = {
      pages: Array.isArray(layout.pages)
        ? layout.pages.map((page) => ({
            ...page,
            // Сохраняем только необходимые поля, чтобы не раздувать localStorage
            blocks: Array.isArray(page.blocks)
              ? page.blocks.map((block) => ({
                  id: block.id,
                  text: block.text,
                  bbox: block.bbox,
                  column: block.column,
                  line: block.line,
                  heading: block.heading || false
                }))
              : [],
            headings: page.headings || [],
            tables: page.tables || []
          }))
        : [],
      summary: layout.summary || {}
    };
  }
  return meta;
};

const roundCoord = (value) => Math.round((Number(value) || 0) * 100) / 100;

const detectLanguageFromText = (text = '') => {
  const cleaned = text.replace(/\s+/g, '');
  if (!cleaned) return 'unknown';
  const cyrillic = (cleaned.match(/[А-Яа-яЁё]/g) || []).length;
  const latin = (cleaned.match(/[A-Za-z]/g) || []).length;
  if (cyrillic > latin * 1.2) return 'ru';
  if (latin > cyrillic * 1.2) return 'en';
  return 'mixed';
};

const groupBlocksIntoLines = (blocks) => {
  if (!Array.isArray(blocks) || !blocks.length) return [];
  const sorted = [...blocks].sort((a, b) => a.bbox[1] - b.bbox[1]);
  const lines = [];
  const tolerance = 6;
  sorted.forEach((block) => {
    const line = lines.find((item) => Math.abs(item.y - block.bbox[1]) <= tolerance);
    if (line) {
      line.blocks.push(block);
      line.y = Math.min(line.y, block.bbox[1]);
      line.maxY = Math.max(line.maxY, block.bbox[3]);
      line.x1 = Math.min(line.x1, block.bbox[0]);
      line.x2 = Math.max(line.x2, block.bbox[2]);
    } else {
      lines.push({
        id: `line-${lines.length + 1}`,
        y: block.bbox[1],
        maxY: block.bbox[3],
        x1: block.bbox[0],
        x2: block.bbox[2],
        blocks: [block]
      });
    }
  });
  lines.forEach((line) => {
    line.text = line.blocks
      .sort((a, b) => a.bbox[0] - b.bbox[0])
      .map((block) => block.text)
      .join(' ');
  });
  return lines;
};

const detectColumns = (blocks, pageWidth) => {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return [{ id: 'col-0', start: 0, end: pageWidth, center: pageWidth / 2 }];
  }

  const centers = blocks
    .map((block) => ({
      center: (block.bbox[0] + block.bbox[2]) / 2,
      block
    }))
    .sort((a, b) => a.center - b.center);

  const gapThreshold = Math.max(pageWidth * 0.08, 42);
  const clusters = [];
  let current = [];

  centers.forEach((entry, index) => {
    if (index === 0) {
      current.push(entry);
      return;
    }
    const prev = centers[index - 1];
    if (entry.center - prev.center > gapThreshold) {
      clusters.push(current);
      current = [entry];
    } else {
      current.push(entry);
    }
  });
  if (current.length) {
    clusters.push(current);
  }

  return clusters.map((cluster, index) => {
    const minX = Math.min(...cluster.map((item) => item.block.bbox[0]));
    const maxX = Math.max(...cluster.map((item) => item.block.bbox[2]));
    const center = cluster.reduce((sum, item) => sum + item.center, 0) / cluster.length;
    return {
      id: `col-${index}`,
      start: roundCoord(Math.max(0, minX - 12)),
      end: roundCoord(Math.min(pageWidth, maxX + 12)),
      center: roundCoord(center),
      blockCount: cluster.length
    };
  });
};

const detectTableRows = (lines, minColumns = 3) => {
  const tables = [];
  let current = [];
  lines.forEach((line) => {
    const meaningfulBlocks = line.blocks.filter((block) => block.text && block.text.trim().length > 0);
    if (meaningfulBlocks.length >= minColumns) {
      current.push(line);
    } else if (current.length) {
      tables.push(current);
      current = [];
    }
  });
  if (current.length) {
    tables.push(current);
  }
  return tables.map((rows, index) => ({
    id: `table-${index + 1}`,
    rows: rows.map((row) => ({
      y: roundCoord(row.y),
      cells: row.blocks
        .sort((a, b) => a.bbox[0] - b.bbox[0])
        .map((block) => ({
          text: block.text,
          bbox: block.bbox
        }))
    }))
  }));
};

const markHeadings = (lines) =>
  lines
    .filter((line) => {
      const cleaned = line.text.replace(/[\d\s.:-]+/g, '').trim();
      if (!cleaned) return false;
      const uppercase = (cleaned.match(/[A-ZА-ЯЁ]/g) || []).length;
      const letters = (cleaned.match(/[A-Za-zА-Яа-яЁё]/g) || []).length || 1;
      const ratio = uppercase / letters;
      if (ratio > 0.65) return true;
      if (/^\d+(\.\d+)*\s/.test(line.text.trim())) return true;
      if (cleaned.length <= 32 && /^[A-ZА-ЯЁ0-9][\w\s«»"'()-]+$/.test(cleaned)) return true;
      return false;
    })
    .map((line) => ({
      text: line.text,
      bbox: [roundCoord(line.x1), roundCoord(line.y), roundCoord(line.x2), roundCoord(line.maxY)],
      id: line.id
    }));

const buildPlainLayout = (pages) => {
  const normalizedPages = Array.isArray(pages) ? pages : [];
  const layoutPages = normalizedPages.map((pageText, pageIndex) => {
    const lines = pageText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((text, index) => ({
        id: `plain-${pageIndex + 1}-${index + 1}`,
        text,
        bbox: [0, index * 20, 600, index * 20 + 18],
        column: 0,
        line: index,
        heading: /^\d+(\.\d+)*\s/.test(text) || text === text.toUpperCase()
      }));
    return {
      pageNumber: pageIndex + 1,
      width: 600,
      height: lines.length * 20,
      columns: [{ id: 'col-0', start: 0, end: 600, center: 300, blockCount: lines.length }],
      headings: lines.filter((line) => line.heading).map((line) => ({ id: line.id, text: line.text, bbox: line.bbox })),
      blocks: lines,
      tables: [],
      language: detectLanguageFromText(pageText)
    };
  });
  return {
    pages: layoutPages,
    summary: {
      pageCount: layoutPages.length,
      headingCount: layoutPages.reduce((sum, page) => sum + page.headings.length, 0),
      tableCount: 0
    }
  };
};

const renderPdfWithPdfjs = async (buffer, trace) => {
  try {
    const pdfjs = await loadPdfjs();
    const loadingTask = pdfjs.getDocument({ data: buffer, disableWorker: true });
    const pdfDoc = await loadingTask.promise;
    const pages = [];
    const layoutPages = [];
    const languages = [];
    for (let pageIndex = 1; pageIndex <= pdfDoc.numPages; pageIndex += 1) {
      const page = await pdfDoc.getPage(pageIndex);
      const content = await page.getTextContent({ normalizeWhitespace: true, includeMarkedContent: true });
      const viewport = page.getViewport({ scale: 1 });
      const blocks = [];
      const Util = pdfjs.Util || pdfjs?.pdfjsLib?.Util;
      content.items.forEach((item, itemIndex) => {
        if (!item || typeof item.str !== 'string' || !item.str.trim()) return;
        const [vx, vy] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        const fontHeight = Math.sqrt((item.transform?.[2] || 0) ** 2 + (item.transform?.[3] || 0) ** 2) || item.height || 0;
        const scaledHeight = fontHeight * viewport.scale;
        const scaledWidth = (item.width || 0) * viewport.scale;
        const bbox = [
          roundCoord(vx),
          roundCoord(vy - scaledHeight),
          roundCoord(vx + scaledWidth),
          roundCoord(vy)
        ];
        const block = {
          id: `pg${pageIndex}-b${itemIndex}`,
          text: item.str.trim(),
          bbox,
          width: roundCoord(scaledWidth),
          height: roundCoord(scaledHeight),
          column: 0,
          line: 0,
          heading: false
        };
        if (Util && typeof Util.transform === 'function') {
          block.transform = Util.transform(viewport.transform, item.transform);
        }
        blocks.push(block);
      });

      const lines = groupBlocksIntoLines(blocks);
      const columns = detectColumns(blocks, viewport.width);
      const headings = markHeadings(lines);
      const tables = detectTableRows(lines);
      blocks.forEach((block) => {
        const column = columns.find((col) => block.bbox[0] >= col.start - 2 && block.bbox[2] <= col.end + 2) || columns[0];
        block.column = column ? Number(column.id.replace('col-', '')) : 0;
        const line = lines.find((ln) => ln.blocks.includes(block));
        block.line = line ? Number(line.id.replace('line-', '')) : 0;
        block.heading = headings.some((heading) => heading.id === (line && line.id));
      });

      const pageText = blocks
        .sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])
        .map((block) => block.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (pageText) {
        pages.push(pageText);
      }

      const language = detectLanguageFromText(pageText);
      languages.push(language);

      layoutPages.push({
        pageNumber: pageIndex,
        width: roundCoord(viewport.width),
        height: roundCoord(viewport.height),
        columns,
        headings,
        blocks,
        tables,
        language
      });

      page.cleanup?.();
    }
    pdfDoc.cleanup?.();
    const combined = pages.join('\n').trim();
    const tableCount = layoutPages.reduce((sum, page) => sum + page.tables.length, 0);
    pushTrace(trace, 'pdfjs', combined ? `Извлечено символов: ${combined.length}` : 'Пустой результат');
    return {
      text: combined,
      pages: [...pages],
      layout: {
        pages: layoutPages,
        summary: {
          pageCount: layoutPages.length,
          headingCount: layoutPages.reduce((sum, page) => sum + page.headings.length, 0),
          tableCount
        }
      },
      languages
    };
  } catch (error) {
    pushTrace(trace, 'pdfjs', `Ошибка pdf.js: ${error.message || error}`, 'error');
    return { text: '', pages: [], layout: null, languages: [] };
  }
};

const extractDocx = async (buffer, trace) => {
  try {
    const JSZip = await loadJSZip();
    const zip = await JSZip.loadAsync(buffer);
    const docFile = zip.file('word/document.xml');
    if (!docFile) {
      pushTrace(trace, 'docx', 'Файл word/document.xml не найден', 'warn');
      return { text: '', pages: [], layout: null, languages: [] };
    }
    const xmlText = await docFile.async('text');
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, 'application/xml');
    const paragraphs = Array.from(xml.getElementsByTagName('w:p'));
    const lines = paragraphs
      .map((paragraph) =>
        Array.from(paragraph.getElementsByTagName('w:t'))
          .map((node) => node.textContent || '')
          .join('')
          .trim()
      )
      .filter(Boolean);
    const combined = lines.join('\n');
    pushTrace(trace, 'docx', `Получено строк: ${lines.length}`);
    const pages = [combined];
    const layout = buildPlainLayout(pages);
    return { text: combined, pages, layout, languages: layout.pages.map((page) => page.language) };
  } catch (error) {
    pushTrace(trace, 'docx', `Ошибка чтения DOCX: ${error.message || error}`, 'error');
    return { text: '', pages: [], layout: null, languages: [] };
  }
};

const ocrPdf = async (buffer, trace, pageLimit = 10) => {
  try {
    const pdfjs = await loadPdfjs();
    const tesseract = await loadTesseract();
    if (!tesseract) {
      pushTrace(trace, 'ocr', 'Tesseract недоступен', 'warn');
      return { text: '', preview: '', pages: [] };
    }
    const pdfDoc = await pdfjs.getDocument({ data: buffer, disableWorker: true }).promise;
    const texts = [];
    let preview = '';
    for (let pageIndex = 1; pageIndex <= Math.min(pageLimit, pdfDoc.numPages); pageIndex += 1) {
      const page = await pdfDoc.getPage(pageIndex);
      const viewport = page.getViewport({ scale: 1.6 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext('2d');
      if (!context) continue;
      await page.render({ canvasContext: context, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/png');
      if (!preview) preview = dataUrl;
      try {
        const { data } = await tesseract.recognize(dataUrl, 'rus+eng', { logger: () => {} });
        if (data?.text) {
          texts.push(data.text.replace(/\s+/g, ' ').trim());
        } else {
          texts.push('');
        }
      } catch (ocrError) {
        pushTrace(trace, 'ocr', `Страница ${pageIndex}: ${ocrError.message || ocrError}`, 'warn');
        texts.push('');
      }
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup?.();
    }
    pdfDoc.cleanup?.();
    const combined = texts.join('\n').trim();
    pushTrace(trace, 'ocr', combined ? `OCR символов: ${combined.length}` : 'OCR дал пустой ответ');
    const pages = normalizePageSegments(texts, combined);
    return { text: combined, preview, pages };
  } catch (error) {
    pushTrace(trace, 'ocr', `Ошибка OCR: ${error.message || error}`, 'error');
    return { text: '', preview: '', pages: [] };
  }
};

const ocrPdfPages = async (buffer, pagesToProcess, trace) => {
  if (!Array.isArray(pagesToProcess) || !pagesToProcess.length) {
    return new Map();
  }
  if (!canUseCanvas()) {
    pushTrace(trace, 'ocr-adaptive', 'Canvas недоступен', 'warn');
    return new Map();
  }
  const targets = Array.from(
    new Set(
      pagesToProcess
        .map((page) => Number(page))
        .filter((page) => Number.isFinite(page) && page >= 1)
    )
  ).sort((a, b) => a - b);
  if (!targets.length) {
    return new Map();
  }
  try {
    const pdfjs = await loadPdfjs();
    const tesseract = await loadTesseract();
    if (!tesseract) {
      pushTrace(trace, 'ocr-adaptive', 'Tesseract недоступен', 'warn');
      return new Map();
    }
    const pdfDoc = await pdfjs.getDocument({ data: buffer, disableWorker: true }).promise;
    const results = new Map();
    for (const pageNumber of targets) {
      if (pageNumber > pdfDoc.numPages) {
        continue;
      }
      try {
        const page = await pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.6 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        if (!context) {
          continue;
        }
        await page.render({ canvasContext: context, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/png');
        const { data } = await tesseract.recognize(dataUrl, 'rus+eng', { logger: () => {} });
        const text = data?.text ? data.text.replace(/\s+/g, ' ').trim() : '';
        if (text) {
          results.set(pageNumber, text);
        }
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup?.();
      } catch (error) {
        pushTrace(trace, 'ocr-adaptive', `Страница ${pageNumber}: ${error.message || error}`, 'warn');
      }
    }
    pdfDoc.cleanup?.();
    if (results.size) {
      pushTrace(trace, 'ocr-adaptive', `Дополнительный OCR: ${Array.from(results.keys()).join(', ')}`);
    }
    return results;
  } catch (error) {
    pushTrace(trace, 'ocr-adaptive', `Ошибка OCR страниц: ${error.message || error}`, 'error');
    return new Map();
  }
};

const serverExtractText = async (file, trace) => {
  if (typeof fetch === 'undefined' || typeof FormData === 'undefined') {
    pushTrace(trace, 'server', 'fetch/FormData недоступны', 'warn');
    return null;
  }
  const apiBase = (resolveApiBase() || '').trim();
  if (!apiBase) {
    pushTrace(trace, 'server', 'Бэкенд не настроен (VITE_API_BASE или window.__API_BASE__ пусты)', 'warn');
    return null;
  }
  const trimmedBase = apiBase.replace(/\/+$/, '');
  const target = `${trimmedBase}/api/extract-text`;
  try {
    const form = new FormData();
    form.append('file', file, file.name || 'document');
    const response = await fetch(target, {
      method: 'POST',
      body: form
    });
    if (!response.ok) {
      pushTrace(trace, 'server', `Ответ ${response.status}`, response.status === 404 ? 'error' : 'warn');
      return null;
    }
    const payload = await response.json();
    pushTrace(trace, 'server', payload?.text ? 'Сервер вернул текст' : 'Сервер ответил без текста');
    return payload;
  } catch (error) {
    pushTrace(trace, 'server', `Ошибка запроса: ${error.message || error}`, 'error');
    return null;
  }
};

export const evaluateSoftPdfAcceptance = (assessment, text) => {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return { readable: false, reason: 'empty', score: -Infinity, text: '' };
  }
  const length = cleaned.length;
  const cyrillic = (cleaned.match(/[А-Яа-яЁё]/g) || []).length;
  const digits = (cleaned.match(/\d/g) || []).length;
  const uniqueChars = new Set(cleaned.split('')).size;
  const score = length / 80 + cyrillic * 0.4 + digits * 0.05 + uniqueChars * 0.1;
  const readable =
    length >= MIN_USEFUL_TEXT_LENGTH ||
    (length >= 120 && cyrillic > 40) ||
    (length >= 120 && digits > 30) ||
    (length >= 70 && cyrillic >= 20 && digits >= 2) ||
    score >= 12;
  return {
    readable,
    reason: readable ? 'accepted' : 'too-short',
    score,
    text: cleaned
  };
};

const buildResponse = ({
  trace,
  strategy = 'auto',
  kind,
  extractor,
  text = '',
  preview = '',
  usedOcr = false,
  extraMeta = {}
}) => ({
  text,
  preview,
  kind,
  meta: {
    extractor,
    strategy,
    usedOcr,
    quality: computeQuality(text),
    trace: [...trace],
    ...extraMeta
  }
});

export const readFileContent = async (file, options = {}) => {
  const strategy = 'auto';
  const trace = [];
  const { onLog, cloudinary: cloudinaryConfig } = options || {};
  const log = (message, level = 'info', extra = {}) => {
    if (typeof onLog === 'function') {
      const entry = typeof message === 'string' ? { message } : { ...message };
      entry.level = entry.level || level;
      entry.at = entry.at || new Date().toISOString();
      if (!entry.scope) {
        entry.scope = 'documents';
      }
      Object.assign(entry, extra);
      onLog(entry);
    }
  };
  if (!file) {
    pushTrace(trace, 'input', 'Файл не передан', 'error');
    log('Файл не передан', 'error');
    return buildResponse({ trace, strategy, kind: 'unknown', extractor: 'none' });
  }

  let arrayBuffer;
  try {
    const buffer = await readAsArrayBuffer(file);
    arrayBuffer = await toArrayBuffer(buffer);
  } catch (bufferError) {
    const message = bufferError?.message || 'Не удалось прочитать файл';
    pushTrace(trace, 'input', message, 'error');
    log(message, 'error', {
      scope: 'documents',
      error: bufferError?.message || null,
      stack: bufferError?.stack || null
    });
    throw new Error('Не удалось обработать файл: повреждённое содержимое или неподдерживаемый формат.');
  }

  if (!arrayBuffer) {
    pushTrace(trace, 'input', 'Не удалось получить ArrayBuffer', 'error');
    log('Не удалось получить ArrayBuffer файла', 'error');
    throw new Error('Не удалось обработать файл: содержимое недоступно.');
  }

  const hashSha256 = await computeSha256(arrayBuffer);
  const detectedKind = detectFileKind(file, arrayBuffer);
  log(`Определён тип файла: ${detectedKind}`, 'info');
  let fileBase64 = '';
  try {
    fileBase64 = arrayBufferToBase64(arrayBuffer);
  } catch (conversionError) {
    const message = conversionError?.message || 'Не удалось подготовить файл';
    pushTrace(trace, 'input', message, 'error');
    log(message, 'error', {
      scope: 'documents',
      error: conversionError?.message || null,
      stack: conversionError?.stack || null
    });
    throw new Error('Не удалось обработать файл: источник повреждён или пуст.');
  }
  const baseMeta = {
    originalName: file?.name || 'document',
    originalType: file?.type || 'application/octet-stream',
    originalSize: file?.size || arrayBuffer.byteLength || 0,
    fileBase64,
    hasAttachment: Boolean(fileBase64) || Boolean(file),
    hashSha256,
    cloudinary: {}
  };

  const cloudinaryReady =
    Boolean(cloudinaryConfig) &&
    Boolean(cloudinaryConfig.cloudName) &&
    Boolean(
      cloudinaryConfig.uploadPreset || (cloudinaryConfig.apiKey && cloudinaryConfig.apiSecret)
    );

  const shouldUploadOriginal = cloudinaryConfig?.uploadOriginalFile ?? false;

  if (cloudinaryReady && fileBase64 && shouldUploadOriginal) {
    log('Загружаем исходный файл в Cloudinary', 'info', { scope: 'cloudinary' });
    const originalUpload = await uploadDataUrlToCloudinary({
      dataUrl: base64ToDataUrl(fileBase64, baseMeta.originalType),
      fileName: baseMeta.originalName,
      config: {
        ...cloudinaryConfig,
        resourceType: resolveCloudinaryResourceType(baseMeta.originalType, cloudinaryConfig)
      },
      log,
      resourceType: resolveCloudinaryResourceType(baseMeta.originalType, cloudinaryConfig),
      tags: ['document-original']
    });
    if (originalUpload?.url) {
      baseMeta.cloudinary.fileUrl = originalUpload.url;
      baseMeta.cloudinary.filePublicId = originalUpload.publicId;
      baseMeta.cloudinary.fileResourceType = originalUpload.resourceType || null;
      baseMeta.cloudinary.fileType = originalUpload.deliveryType || null;
    }
  } else if (cloudinaryReady && !shouldUploadOriginal) {
    log('Загрузка оригинального файла отключена настройками', 'info', { scope: 'cloudinary' });
  }

  const chooseText = (text, extractor, extra = {}) =>
    buildResponse({
      trace,
      strategy,
      kind: detectedKind,
      extractor,
      text,
      usedOcr: extractor === 'pdf-ocr',
      extraMeta: { ...baseMeta, ...extra }
    });

  if (detectedKind === 'docx') {
    const docx = await extractDocx(arrayBuffer, trace);
    return chooseText(
      docx.text,
      'docx',
      buildPageMeta(docx.text, docx.pages, docx.layout, docx.languages)
    );
  }

  if (detectedKind === 'text') {
    pushTrace(trace, 'text', 'Пробуем декодировать текстовый файл');
    const text = decodeTextBuffer(arrayBuffer);
    const pages = [text];
    const layout = buildPlainLayout(pages);
    return chooseText(
      text,
      'text',
      buildPageMeta(text, pages, layout, layout.pages.map((page) => page.language))
    );
  }

  if (detectedKind === 'pdf') {
    // Подготовим копии буфера заранее, пока он гарантированно не отсоединён
    const pdfBufferForText = cloneArrayBuffer(arrayBuffer) || arrayBuffer;
    const pdfBufferForImages = cloudinaryReady ? cloneArrayBuffer(arrayBuffer) : null;
    const pdfBufferForOcr = cloneArrayBuffer(arrayBuffer) || arrayBuffer;

    if (cloudinaryReady && !pdfBufferForImages) {
      log('Не удалось подготовить буфер для генерации изображений страниц', 'warn', {
        scope: 'cloudinary'
      });
    }

    // Автоматический конвейер для PDF: pdf.js → сервер → OCR
    const pdfResult = await renderPdfWithPdfjs(pdfBufferForText, trace);
    const pdfMeta = buildPageMeta(
      pdfResult.text,
      pdfResult.pages,
      pdfResult.layout,
      pdfResult.languages
    );

    if (cloudinaryReady) {
      const pageImages = pdfBufferForImages
        ? await renderPdfPageImages(pdfBufferForImages, {
            scale: cloudinaryConfig.pageImageScale || PAGE_IMAGE_SCALE,
            maxPages: cloudinaryConfig.maxPageImages || MAX_PAGE_IMAGES,
            log
          })
        : [];
      if (pageImages.length) {
        const uploadedPages = await uploadPageImages({
          images: pageImages,
          baseName: baseMeta.originalName,
          config: cloudinaryConfig,
          log
        });
        if (uploadedPages.length) {
          pdfMeta.pageImages = uploadedPages.map(({ page, url, width, height }) => ({
            page,
            url,
            width,
            height
          }));
          baseMeta.cloudinary.pageImages = uploadedPages;

          const expectedPages =
            pdfMeta.pageCount
            || pdfMeta.layoutPageCount
            || pdfMeta.layout?.summary?.pageCount
            || (Array.isArray(pdfResult.layout?.pages) ? pdfResult.layout.pages.length : 0);
          const uploadedNumbers = uploadedPages
            .map((item) => (Number.isFinite(Number(item.page)) ? Number(item.page) : null))
            .filter((page) => Number.isFinite(page))
            .sort((a, b) => a - b);
          const missingPages = expectedPages
            ? Array.from({ length: expectedPages }, (_, index) => index + 1).filter(
                (page) => !uploadedNumbers.includes(page)
              )
            : [];
          log(
            missingPages.length ? 'Страницы загружены не полностью' : 'Страницы загружены в Cloudinary',
            missingPages.length ? 'warn' : 'info',
            {
              scope: 'cloudinary',
              uploadedPages: uploadedPages.length,
              expectedPages: expectedPages || null,
              pageNumbers: uploadedNumbers,
              missingPages: missingPages.length ? missingPages : null,
              maxPages: cloudinaryConfig?.maxPageImages || MAX_PAGE_IMAGES
            }
          );

          const archive = await createPageArchiveDataUrl(pageImages, baseMeta.originalName);
          if (archive?.dataUrl) {
            const archiveUpload = await uploadDataUrlToCloudinary({
              dataUrl: archive.dataUrl,
              fileName: archive.fileName,
              config: cloudinaryConfig,
              log,
              resourceType: 'raw',
              tags: ['document-pages-archive']
            });
            if (archiveUpload?.url) {
              baseMeta.cloudinary.archiveUrl = archiveUpload.url;
              baseMeta.cloudinary.archivePublicId = archiveUpload.publicId;
              pdfMeta.cloudinaryArchiveUrl = archiveUpload.url;
            }
          }
        } else {
          log('Не удалось загрузить изображения страниц в Cloudinary', 'warn', { scope: 'cloudinary' });
        }
      }
      if (!pageImages.length) {
        const expectedPages =
          pdfMeta.pageCount
          || pdfMeta.layoutPageCount
          || pdfMeta.layout?.summary?.pageCount
          || (Array.isArray(pdfResult.layout?.pages) ? pdfResult.layout.pages.length : 0);
        log('Не удалось создать локальные изображения страниц PDF', 'warn', {
          scope: 'cloudinary',
          expectedPages: expectedPages || null
        });
      }
      if (baseMeta.cloudinary.filePublicId && cloudinaryConfig?.cloudName) {
        const hasUploadedPages = Array.isArray(baseMeta.cloudinary.pageImages) && baseMeta.cloudinary.pageImages.length > 0;
        if (!hasUploadedPages) {
          const fallbackPages = buildCloudinaryPagePreviewUrls({
            cloudName: cloudinaryConfig.cloudName,
            publicId: baseMeta.cloudinary.filePublicId,
            resourceType: baseMeta.cloudinary.fileResourceType || resolveCloudinaryResourceType(baseMeta.originalType, cloudinaryConfig),
            deliveryType: baseMeta.cloudinary.fileType || cloudinaryConfig.deliveryType || 'upload',
            pageCount:
              pdfMeta.pageCount
              || pdfMeta.layoutPageCount
              || pdfMeta.layout?.summary?.pageCount
              || (Array.isArray(pdfResult.layout?.pages) ? pdfResult.layout.pages.length : 0),
            format: cloudinaryConfig.pageImageFormat || 'png',
            quality: cloudinaryConfig.pageImageQuality || 'auto:eco',
            customTransformation: cloudinaryConfig.pageImageTransformation
          });
          if (fallbackPages.length) {
            pdfMeta.pageImages = fallbackPages.map(({ page, url }) => ({ page, url }));
            baseMeta.cloudinary.pageImages = fallbackPages;
            const expectedPages =
              pdfMeta.pageCount
              || pdfMeta.layoutPageCount
              || pdfMeta.layout?.summary?.pageCount
              || (Array.isArray(pdfResult.layout?.pages) ? pdfResult.layout.pages.length : 0);
            const fallbackNumbers = fallbackPages
              .map((item) => (Number.isFinite(Number(item.page)) ? Number(item.page) : null))
              .filter((page) => Number.isFinite(page))
              .sort((a, b) => a - b);
            const missingPages = expectedPages
              ? Array.from({ length: expectedPages }, (_, index) => index + 1).filter(
                  (page) => !fallbackNumbers.includes(page)
                )
              : [];
            log(
              missingPages.length
                ? 'Используем трансформации Cloudinary, но часть страниц недоступна'
                : 'Используем трансформации Cloudinary для страниц',
              missingPages.length ? 'warn' : 'info',
              {
                scope: 'cloudinary',
                pages: fallbackPages.length,
                expectedPages: expectedPages || null,
                pageNumbers: fallbackNumbers,
                missingPages: missingPages.length ? missingPages : null
              }
            );
          } else {
            log('Не удалось получить изображения страниц через Cloudinary', 'warn', { scope: 'cloudinary' });
          }
        }
      }
    }

    const qualityScores = pdfMeta.pages.map((page) => computeQuality(page));
    const lowQualityPages = qualityScores
      .map((score, index) => ({ score, page: index + 1 }))
      .filter((entry) => entry.score < OCR_QUALITY_THRESHOLD)
      .map((entry) => entry.page);

    if (lowQualityPages.length) {
      const patches = await ocrPdfPages(pdfBufferForOcr, lowQualityPages, trace);
      const patchedPages = [];
      patches.forEach((text, pageNumber) => {
        const normalized = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
        if (!normalized) return;
        const index = pageNumber - 1;
        while (pdfMeta.pages.length < pageNumber) {
          pdfMeta.pages.push('');
        }
        pdfMeta.pages[index] = normalized;
        if (Array.isArray(pdfResult.pages)) {
          while (pdfResult.pages.length < pageNumber) {
            pdfResult.pages.push('');
          }
          pdfResult.pages[index] = normalized;
        }
        if (!Array.isArray(pdfMeta.languages)) {
          pdfMeta.languages = [];
        }
        const language = detectLanguageFromText(normalized);
        pdfMeta.languages[index] = language;
        if (!Array.isArray(pdfResult.languages)) {
          pdfResult.languages = [];
        }
        pdfResult.languages[index] = language;
        patchedPages.push(pageNumber);
      });
      if (patchedPages.length) {
        pdfMeta.pageTaggedText = buildPageTaggedText(pdfMeta.pages);
        pdfMeta.ocrPatchedPages = patchedPages;
        pdfMeta.pageCount = pdfMeta.pages.length || pdfMeta.layoutPageCount || 0;
        pdfResult.text = pdfMeta.pages.join('\n');
        pushTrace(
          trace,
          'ocr-adaptive',
          `Подменены страницы: ${patchedPages.join(', ')} (порог ${OCR_QUALITY_THRESHOLD})`
        );
      }
    }

    const effectivePdfText = (pdfResult.text || '').trim();
    const pdfAssessment = evaluateSoftPdfAcceptance({}, effectivePdfText);
    const trimmedPdfText = effectivePdfText;
    if (trimmedPdfText) {
      if (!pdfAssessment.readable) {
        pushTrace(
          trace,
          'pdfjs',
          `Используем текст длиной ${trimmedPdfText.length}, несмотря на низкий балл`,
          'warn'
        );
      }
      return chooseText(trimmedPdfText, pdfAssessment.readable ? 'pdfjs' : 'pdfjs-soft', pdfMeta);
    }

    const serverResult = await serverExtractText(file, trace);
    if (serverResult?.text && serverResult.text.trim().length >= 40) {
      const serverPages = Array.isArray(serverResult?.meta?.pages)
        ? serverResult.meta.pages
        : [serverResult.text];
      const serverLayout = buildPlainLayout(serverPages);
      const meta = buildPageMeta(
        serverResult.text,
        serverPages,
        serverLayout,
        serverLayout.pages.map((page) => page.language)
      );
      return chooseText(serverResult.text, serverResult?.meta?.extractor || 'server-pymupdf', meta);
    }

    const { text: ocrText, preview, pages } = await ocrPdf(pdfBufferForOcr, trace);
    if (ocrText && ocrText.trim().length >= 40) {
      const ocrPages = pages && pages.length ? pages : [ocrText];
      const ocrLayout = buildPlainLayout(ocrPages);
      const meta = buildPageMeta(
        ocrText,
        ocrPages,
        ocrLayout,
        ocrLayout.pages.map((page) => page.language)
      );
      return buildResponse({
        trace,
        strategy,
        kind: detectedKind,
        extractor: 'pdf-ocr',
        text: ocrText,
        preview,
        usedOcr: true,
        extraMeta: { ...baseMeta, ...meta }
      });
    }

    pushTrace(trace, 'pdf', 'Текст не извлечён, возвращаем пустой результат', 'warn');
    return chooseText('', 'pdf-unreadable');
  }

  if (detectedKind === 'image') {
    pushTrace(trace, 'image', 'Запуск OCR для изображения');
    const dataUrl = await readAsDataURL(file);
    const tesseract = await loadTesseract();
    if (!tesseract) {
      return buildResponse({
        trace,
        strategy,
        kind: 'image',
        extractor: 'image-preview',
        text: '',
        preview: dataUrl,
        extraMeta: { ...baseMeta, ...buildPageMeta('', [], null, []) }
      });
    }
    try {
      const { data } = await tesseract.recognize(dataUrl, 'rus+eng', { logger: () => {} });
      const recognizedText = data?.text || '';
      const pages = [recognizedText];
      const layout = buildPlainLayout(pages);
      return buildResponse({
        trace,
        strategy,
        kind: 'image',
        extractor: 'image-ocr',
        text: recognizedText,
        preview: dataUrl,
        usedOcr: true,
        extraMeta: {
          ...baseMeta,
          ...buildPageMeta(recognizedText, pages, layout, layout.pages.map((page) => page.language))
        }
      });
    } catch (error) {
      pushTrace(trace, 'image', `Ошибка OCR: ${error.message || error}`, 'error');
      return buildResponse({
        trace,
        strategy,
        kind: 'image',
        extractor: 'image-preview',
        text: '',
        preview: dataUrl,
        extraMeta: { ...baseMeta, ...buildPageMeta('', [], null, []) }
      });
    }
  }

  // Unknown binary file – return base64 preview but no text
  pushTrace(trace, 'binary', 'Неизвестный тип файла, возвращаем base64');
  const binaryBase64 = arrayBufferToBase64(arrayBuffer);
  return buildResponse({
    trace,
    strategy,
    kind: 'binary',
    extractor: 'binary',
    text: '',
    preview: binaryBase64 ? `data:application/octet-stream;base64,${binaryBase64}` : ''
  });
};

export const renderTextToImage = (text) => {
  if (!canUseCanvas()) return '';
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return '';
  const width = 1024;
  const padding = 48;
  const font = '16px "Inter", "Segoe UI", sans-serif';
  context.font = font;
  const lines = wrapText(context, trimSnippet(text, IMAGE_PREVIEW_MAX_CHARS), width - padding * 2, 24);
  const height = Math.min(1200, Math.max(280, lines.length * 24 + padding * 2));
  canvas.width = width;
  canvas.height = height;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#1b1d29';
  context.font = font;
  lines.slice(0, Math.floor((height - padding * 2) / 24)).forEach((line, index) => {
    context.fillText(line, padding, padding + 24 * (index + 1) - 6);
  });
  return canvas.toDataURL('image/png');
};

const wrapText = (context, text, maxWidth, lineHeight) => {
  if (!text) return ['Документ не распознан'];
  const paragraphs = text.split(/\n+/);
  const lines = [];
  paragraphs.forEach((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      return;
    }
    let current = '';
    words.forEach((word) => {
      const test = current ? `${current} ${word}` : word;
      if (context.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    });
    if (current) {
      lines.push(current);
    }
  });
  return lines.length ? lines : ['Документ не распознан'];
};

export const convertFileToImage = async (file, content) => {
  try {
    if (content?.preview) {
      return content.preview;
    }
    if (file?.type?.startsWith('image/')) {
      return await readAsDataURL(file);
    }
    if (content?.text) {
      return renderTextToImage(content.text);
    }
    return '';
  } catch (error) {
    return '';
  }
};

export const buildDocumentInsights = (files = []) => {
  const insights = {
    parties: new Set(),
    deadlines: [],
    monetary: [],
    risks: new Set(),
    signatures: 0,
    totalLength: 0
  };

  files.forEach((file) => {
    const text = file.fullText || file.text || '';
    if (!text) return;
    insights.totalLength += text.length;
    const matches = text.match(/[Пп]окупател[ья]|[Пп]родавц[ае]|[Аа]рендатор|[Аа]рендодатель|[Ии]сполнитель|[Зз]аказчик/g);
    matches?.forEach((item) => insights.parties.add(item.toLowerCase()));
    const deadlineMatches = text.match(/\d{1,3}\s*(?:календарн|рабочих)\s*дн/gi);
    if (deadlineMatches) {
      insights.deadlines.push(...deadlineMatches);
    }
    const moneyMatches = text.match(/\d[\d\s.,]{2,}\s*(?:руб|eur|usd|евро|доллар)/gi);
    if (moneyMatches) {
      insights.monetary.push(...moneyMatches);
    }
    if (/штраф|неусто/.test(text)) insights.risks.add('penalty');
    if (/односторонн/.test(text)) insights.risks.add('unilateral');
    if (/подпись|signature/i.test(text)) insights.signatures += 1;
  });

  return {
    parties: Array.from(insights.parties).slice(0, 6),
    deadlines: insights.deadlines.slice(0, 6),
    monetary: insights.monetary.slice(0, 6),
    risks: Array.from(insights.risks),
    signatures: insights.signatures,
    totalLength: insights.totalLength
  };
};

export const mapInsightsToFields = (fields = [], insights = {}) => {
  const result = {};
  fields.forEach((field) => {
    if (/роль|сторона/i.test(field.label || '') && insights.parties?.length) {
      result[field.id] = insights.parties[0];
    }
    if (/срок/i.test(field.label || '') && insights.deadlines?.length) {
      result[field.id] = insights.deadlines[0];
    }
    if (/сумм|стоим/i.test(field.label || '') && insights.monetary?.length) {
      result[field.id] = insights.monetary[0];
    }
  });
  return result;
};

export const formatDocumentInsights = (insights = {}) => {
  const entries = [];
  if (insights.parties?.length) {
    entries.push({ id: 'parties', label: `Упомянутые стороны: ${insights.parties.join(', ')}` });
  }
  if (insights.monetary?.length) {
    entries.push({ id: 'money', label: `Финансовые условия: ${insights.monetary.slice(0, 3).join(', ')}` });
  }
  if (insights.deadlines?.length) {
    entries.push({ id: 'deadlines', label: `Сроки исполнения: ${insights.deadlines.slice(0, 3).join(', ')}` });
  }
  if (insights.risks?.length) {
    const humanReadable = insights.risks
      .map((risk) => (risk === 'penalty' ? 'штрафные санкции' : risk === 'unilateral' ? 'односторонние права' : risk))
      .join(', ');
    entries.push({ id: 'risks', label: `Обнаружены риски: ${humanReadable}` });
  }
  if (insights.signatures) {
    entries.push({ id: 'signatures', label: `Полей для подписи: ${insights.signatures}` });
  }
  return entries;
};

