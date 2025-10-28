import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Check, Download, Loader2, Moon, Printer, Sun, UploadCloud } from 'lucide-react';
import { useApiKey } from '../hooks/useApiKey.js';
import { useGptSettings } from '../hooks/useGptSettings.js';
import { getThemeClass } from '../hooks/useTheme.js';
import { readFileContent } from '../lib/documents.js';
import {
  analyzeDocuments,
  formatAnalysisLayout,
  prepareAdaptivePrompt,
  prepareSummaryPreview
} from '../lib/openai.js';
import { MAX_FILE_SIZE_BYTES } from '../lib/config.js';
import { formatFileSize } from '../lib/telegram.js';

const ACCENT_COLOR = '#C9A86A';
const LOG_STORAGE_KEY = 'dokneg-optima:analysis-log';
const MAX_LOG_ENTRIES = 200;

const prettyBytes = (bytes) => {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
};

const formatDisplayFileName = (name, limit = 20) => {
  if (!name || typeof name !== 'string') return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  const dotIndex = trimmed.lastIndexOf('.');
  const base = dotIndex > 0 ? trimmed.slice(0, dotIndex) : trimmed;
  const ext = dotIndex > 0 ? trimmed.slice(dotIndex + 1) : '';
  if (base.length <= limit) {
    return ext ? `${base}.${ext}` : base;
  }
  const shortened = base.slice(0, limit);
  return ext ? `${shortened}... .${ext}` : `${shortened}...`;
};

const formatDateTime = (date) =>
  new Date(date || Date.now()).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

const appendLogEntry = (entry) => {
  if (typeof window === 'undefined') return;
  try {
    const storage = window.localStorage;
    const raw = storage.getItem(LOG_STORAGE_KEY);
    const list = Array.isArray(raw ? JSON.parse(raw) : []) ? JSON.parse(raw || '[]') : [];
    const payload =
      typeof entry === 'string'
        ? { message: entry }
        : { ...(entry || {}), message: entry?.message || entry?.detail || 'log' };
    payload.at = payload.at || new Date().toISOString();
    payload.level = payload.level || 'info';
    payload.scope = payload.scope || 'app';
    list.push(payload);
    if (list.length > MAX_LOG_ENTRIES) {
      list.splice(0, list.length - MAX_LOG_ENTRIES);
    }
    storage.setItem(LOG_STORAGE_KEY, JSON.stringify(list));
  } catch (error) {
    // ignore storage failures
  }
};

const stripTrailing = (value) => {
  let text = value;
  let suffix = '';
  while (/[)\],.;!?]$/.test(text)) {
    suffix = text.slice(-1) + suffix;
    text = text.slice(0, -1);
  }
  return { text, suffix };
};

const sanitizeExternalLink = (url) => {
  try {
    const parsed = new URL(url);
    const params = new URLSearchParams(parsed.search);
    const keysToDelete = [];
    params.forEach((value, key) => {
      const keyLower = key.toLowerCase();
      const valueLower = (value || '').toLowerCase();
      if (keyLower.includes('openai') || valueLower.includes('openai')) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach((key) => params.delete(key));
    parsed.search = params.toString() ? `?${params.toString()}` : '';
    if (parsed.hash && parsed.hash.toLowerCase().includes('openai')) {
      parsed.hash = '';
    }
    let sanitized = parsed.toString();
    if (sanitized.endsWith('?')) {
      sanitized = sanitized.slice(0, -1);
    }
    return sanitized;
  } catch (error) {
    return url;
  }
};

const LinkifiedText = ({ text }) => {
  if (!text) return null;
  const parts = [];
  let lastIndex = 0;
  const regex = /(https?:\/\/[^\s<>"]+)/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) {
      parts.push(<React.Fragment key={`t-${lastIndex}`}>{before}</React.Fragment>);
    }
    const { text: cleanUrl, suffix } = stripTrailing(match[0]);
    if (cleanUrl) {
      const sanitizedUrl = sanitizeExternalLink(cleanUrl);
      parts.push(
        <a key={`l-${match.index}`} href={sanitizedUrl} target="_blank" rel="noopener noreferrer">
          {sanitizedUrl}
        </a>
      );
    }
    if (suffix) {
      parts.push(<React.Fragment key={`s-${match.index}`}>{suffix}</React.Fragment>);
    }
    lastIndex = regex.lastIndex;
  }
  const after = text.slice(lastIndex);
  if (after) {
    parts.push(<React.Fragment key="tail">{after}</React.Fragment>);
  }
  if (!parts.length) {
    return <>{text}</>;
  }
  return <>{parts}</>;
};

const Step = ({ index, label, status }) => {
  const content = status === 'done' ? '✓' : index;
  return (
    <div className={`negve-step negve-step--${status}`}>
      <span className="negve-step__index">{content}</span>
      <span className="negve-step__label">{label}</span>
    </div>
  );
};

const BASE_STAGE_MESSAGES = {
  reading: {
    icon: Loader2,
    spinning: true,
    title: 'Обрабатываем документ',
    note: 'Извлекаем текст и изображения. Подготовка может занять до 10 минут.'
  },
  triage: {
    icon: Loader2,
    spinning: true,
    title: 'Предварительный анализ и уточнение деталей',
    note: 'Этап может занять до 2 минут.'
  },
  'summary-ready': {
    icon: Check,
    spinning: false,
    title: 'Предварительный анализ готов',
    note: 'Проверьте сводку и ответьте на вопросы, прежде чем запускать глубокий анализ.'
  },
  analyzing: {
    icon: Loader2,
    spinning: true,
    title: 'Анализируем документ(ы)',
    note: 'Готовим финальный отчёт. Анализ может занять до 10 минут.'
  },
  formatting: {
    icon: Loader2,
    spinning: true,
    title: 'Шаг 4 — Оформление отчёта',
    note: 'Формируем финальный отчёт. Процесс может занять до 2 минут.'
  }
};

const STAGE_PROGRESS = {
  idle: 0,
  reading: 18,
  triage: 38,
  'summary-ready': 56,
  analyzing: 82,
  formatting: 94,
  done: 100
};

const PRIORITY_LABELS = {
  P1: 'Приоритет 1 — Срочные действия',
  P2: 'Приоритет 2 — Требует внимания',
  P3: 'Приоритет 3 — Рекомендуется проверить',
  P4: 'Приоритет 4 — Для контроля'
};

const RISK_LABELS = {
  R1: 'Критический риск',
  R2: 'Высокий риск',
  R3: 'Средний риск',
  R4: 'Низкий риск'
};

const SummaryPreview = ({ summaryPoints = [], questions = [], answers, onAnswer, freeText, onFreeText, freeTextMeta }) => (
  <div className="negve-card negve-card--result">
    <div className="negve-card__header">
      <div>
        <div className="negve-card__title">Предварительное резюме</div>
        <div className="negve-card__subtitle">Ответьте на уточняющие вопросы перед запуском анализа</div>
      </div>
    </div>
    <div className="negve-card__block">
      {summaryPoints.length ? (
        <ul className="negve-summary-list">
          {summaryPoints.map((point, index) => (
            <li key={index}>{point}</li>
          ))}
        </ul>
      ) : (
        <p className="negve-text-muted">GPT не вернул ключевые пункты предварительного резюме.</p>
      )}
    </div>
    {questions.length > 0 && (
      <div className="negve-card__block">
        <div className="negve-section-heading">Уточняющие вопросы</div>
        <div className="negve-question-list">
          {questions.map((question) => (
            <div key={question.id} className="negve-question">
              <div className="negve-question__label">{question.question}</div>
              <div className="negve-question__options">
                {question.options.map((option) => {
                  const selected = answers[question.id]?.id === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={`negve-chip ${selected ? 'negve-chip--active' : ''}`}
                      onClick={() => onAnswer(question.id, option)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              {answers[question.id]?.instruction && (
                <div className="negve-question__hint">
                  <LinkifiedText text={answers[question.id].instruction} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    )}
    {freeTextMeta && (
      <div className="negve-card__block">
        <div className="negve-section-heading">{freeTextMeta.label || 'Дополнительные комментарии'}</div>
        <textarea
          className="negve-textarea"
          rows={3}
          placeholder={freeTextMeta.hint || 'Укажите особенности, которые нужно учесть'}
          value={freeText}
          onChange={(event) => onFreeText(event.target.value)}
        />
      </div>
    )}
  </div>
);

const normalizePriorityLabel = (priority, index) => {
  const raw = typeof priority === 'string' ? priority.trim() : '';
  if (!raw) {
    return `Приоритет ${index + 1}`;
  }
  const normalized = raw.toUpperCase();
  return PRIORITY_LABELS[normalized] || raw;
};

const normalizeRiskLabel = (title, level, index) => {
  const raw = typeof title === 'string' ? title.trim() : '';
  if (!raw) {
    return `Риск ${index + 1}`;
  }
  const normalized = raw.toUpperCase();
  if (RISK_LABELS[normalized]) {
    return `${RISK_LABELS[normalized]}${level ? ` (${level})` : ''}`;
  }
  if (level && !raw.toLowerCase().includes(level.toLowerCase())) {
    return `${raw} (${level})`;
  }
  return raw;
};

const LayoutReport = ({ layout, fallbackHint, sources }) => {
  if (!layout) return null;
  const meta = layout.meta || {};
  const sections = layout.sections || {};
  const tone = layout.layout?.tone || 'balanced';
  const safeSources = Array.isArray(sources) ? sources.filter(Boolean) : [];

  const safeArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);
  const displayDocumentName = formatDisplayFileName(meta.documentName || '—');

  return (
    <div className="negve-layout" data-tone={tone}>
      <div className="negve-card negve-card--result">
        <div className="negve-card__header negve-card__header--compact">
          <div>
            <div className="negve-card__title">{meta.title || 'Юридический отчёт'}</div>
            <div className="negve-card__subtitle">{meta.subtitle || fallbackHint || 'Структурированная сводка'}</div>
          </div>
        </div>
        <div className="negve-layout__meta">
          <div>
            <span>Документ:</span>
            <strong title={meta.documentName || undefined}>{displayDocumentName || '—'}</strong>
          </div>
          <div>
            <span>Подготовлено для:</span>
            <strong>{meta.preparedFor || 'Клиент'}</strong>
          </div>
          <div>
            <span>Аналитик:</span>
            <strong>{meta.preparedBy || 'GPT-5 mini'}</strong>
          </div>
          <div>
            <span>Дата:</span>
            <strong>{meta.date || formatDateTime(Date.now())}</strong>
          </div>
        </div>
      </div>

      {sections.summary && (
        <div className="negve-card negve-card--result">
          <div className="negve-card__header negve-card__header--compact">
            <div className="negve-card__title">Краткое резюме</div>
          </div>
          <div className="negve-card__block">
            <LinkifiedText text={sections.summary} />
          </div>
        </div>
      )}

      {safeArray(sections.card).length > 0 && (
        <div className="negve-card negve-card--result">
          <div className="negve-card__header negve-card__header--compact">
            <div className="negve-card__title">Карточка документа</div>
          </div>
          <div className="negve-card__block negve-card__block--grid">
            {safeArray(sections.card).map((item, index) => (
              <div key={index} className="negve-info-tile">
                <LinkifiedText text={item} />
              </div>
            ))}
          </div>
        </div>
      )}

      {safeArray(sections.quotes).length > 0 && (
        <div className="negve-card negve-card--result">
          <div className="negve-card__header negve-card__header--compact">
            <div className="negve-card__title">Ключевые цитаты</div>
          </div>
          <div className="negve-card__block negve-card__block--grid">
            {safeArray(sections.quotes).map((quote, index) => (
              <div key={index} className="negve-quote">
                <div className="negve-quote__ref">{quote.ref || `#${index + 1}`}</div>
                <div className="negve-quote__text">{quote.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {safeArray(sections.actions).length > 0 && (
        <div className="negve-card negve-card--result">
          <div className="negve-card__header negve-card__header--compact">
            <div className="negve-card__title">Что делать сейчас</div>
          </div>
          <div className="negve-card__block negve-card__block--stack">
            {safeArray(sections.actions).map((block, index) => (
              <div key={index} className="negve-action-block">
                <div className="negve-action-block__title">{normalizePriorityLabel(block.priority, index)}</div>
                <div className="negve-action-block__items">
                  {safeArray(block.items).map((item, itemIndex) => (
                    <div key={itemIndex} className="negve-action">
                      <div className="negve-action__label">Проблема</div>
                      <div className="negve-action__value"><LinkifiedText text={item.problem} /></div>
                      <div className="negve-action__label">Действие</div>
                      <div className="negve-action__value"><LinkifiedText text={item.action} /></div>
                      <div className="negve-action__label">Почему</div>
                      <div className="negve-action__value"><LinkifiedText text={item.why} /></div>
                      {safeArray(item.refs).length > 0 && (
                        <div className="negve-action__refs">Ссылки: {item.refs.join(', ')}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {safeArray(sections.risks).length > 0 && (
        <div className="negve-card negve-card--result">
          <div className="negve-card__header negve-card__header--compact">
            <div className="negve-card__title">Топ‑риски</div>
          </div>
          <div className="negve-card__block negve-card__block--grid">
            {safeArray(sections.risks).map((risk, index) => (
              <div key={index} className={`negve-risk negve-risk--${(risk.level || '').toLowerCase()}`}>
                <div className="negve-risk__title">{normalizeRiskLabel(risk.title, risk.level, index)}</div>
                <div className="negve-risk__item">
                  <span>Последствие:</span> <LinkifiedText text={risk.consequence} />
                </div>
                <div className="negve-risk__item">
                  <span>Как исправить:</span> <LinkifiedText text={risk.fix} />
                </div>
                {safeArray(risk.refs).length > 0 && (
                  <div className="negve-risk__refs">Ссылки: {risk.refs.join(', ')}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {safeArray(sections.redlines).length > 0 && (
        <div className="negve-card negve-card--result">
          <div className="negve-card__header negve-card__header--compact">
            <div className="negve-card__title">Мини‑редлайны</div>
          </div>
          <div className="negve-card__block negve-card__block--stack">
            {safeArray(sections.redlines).map((redline, index) => (
              <div key={index} className="negve-redline">
                <div className="negve-redline__label">Текущий текст</div>
                <div className="negve-redline__value"><LinkifiedText text={redline.current} /></div>
                <div className="negve-redline__label negve-redline__label--proposed">Предлагаемая редакция</div>
                <div className="negve-redline__value"><LinkifiedText text={redline.proposal} /></div>
                {redline.goal && <div className="negve-redline__goal">Цель: {redline.goal}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {safeArray(sections.questions).length > 0 && (
        <div className="negve-card negve-card--result">
          <div className="negve-card__header negve-card__header--compact">
            <div className="negve-card__title">Вопросы контрагенту</div>
          </div>
          <div className="negve-card__block">
            <ol className="negve-questions-list">
              {sections.questions.map((question, index) => (
                <li key={index}>
                  <LinkifiedText text={question} />
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {(sections.readiness || sections.notes?.length) && (
        <div className="negve-card negve-card--result">
          <div className="negve-card__header negve-card__header--compact">
            <div className="negve-card__title">Готовность к подписанию</div>
          </div>
          <div className="negve-card__block">
            {sections.readiness && <p><LinkifiedText text={sections.readiness} /></p>}
            {safeArray(sections.notes).length > 0 && (
              <ul className="negve-summary-list">
                {sections.notes.map((note, index) => (
                  <li key={index}>
                    <LinkifiedText text={note} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {sections.source && (
        <div className="negve-card negve-card--result">
          <div className="negve-card__header negve-card__header--compact">
            <div className="negve-card__title">Источник</div>
          </div>
          <div className="negve-card__block">
            <LinkifiedText text={sections.source} />
          </div>
        </div>
      )}

      {safeSources.length > 0 && (
        <div className="negve-card negve-card--result">
          <div className="negve-card__header negve-card__header--compact">
            <div>
              <div className="negve-card__title">Внешние источники</div>
              <div className="negve-card__subtitle">Результаты web-search модели</div>
            </div>
          </div>
          <div className="negve-card__block negve-card__block--stack">
            {safeSources.map((source, index) => {
              const title = source.title || `Источник ${index + 1}`;
              const url = source.url;
              const safeUrl = url ? sanitizeExternalLink(url) : '';
              const snippet = source.snippet;
              return (
                <div key={`${title}-${index}`} className="negve-source">
                  <div className="negve-source__title">
                    {title}
                    {safeUrl && (
                      <a href={safeUrl} target="_blank" rel="noopener noreferrer">
                        {safeUrl}
                      </a>
                    )}
                  </div>
                  {source.publishedAt && (
                    <div className="negve-source__meta">{source.publishedAt}</div>
                  )}
                  {snippet && (
                    <div className="negve-source__snippet">
                      <LinkifiedText text={snippet} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const escapeHtml = (value) => {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const buildLayoutHtml = (layout, fallbackHint, sources = []) => {
  if (!layout) return '';
  const summary = layout.sections?.summary || '';
  const docName = layout.meta?.documentName || 'Документ';
  const displayDocName = formatDisplayFileName(docName);
  const generatedAt = formatDateTime(Date.now());
  const safeSources = Array.isArray(sources) ? sources : [];
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>Отчёт — ${docName}</title>
<style>
  body { font-family: 'Inter', sans-serif; padding: 32px; background: #f8fafc; color: #0f172a; }
  h1 { margin-bottom: 4px; }
  h2 { margin-top: 32px; margin-bottom: 12px; }
  .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 20px 0; }
  .block { background: #ffffff; border: 1px solid #dbe3f0; border-radius: 16px; padding: 20px; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
  .quote { border-left: 4px solid ${ACCENT_COLOR}; padding-left: 12px; }
  .action { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; background: #fff9ef; }
  .source { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; background: #ffffff; }
  .source-title { display: flex; flex-direction: column; gap: 6px; font-weight: 600; }
  .source-title a { color: #1d4ed8; font-weight: 500; word-break: break-all; }
  .source-snippet { margin-top: 8px; color: #334155; }
  .source-meta { margin-top: 6px; font-size: 0.85rem; color: #64748b; }
  .avoid-break { break-inside: avoid; page-break-inside: avoid; }
  ol { padding-left: 18px; }
  li { margin-bottom: 8px; }
</style>
</head>
<body>
  <h1>${layout.meta?.title || 'Юридический отчёт'}</h1>
  <p>${layout.meta?.subtitle || fallbackHint || ''}</p>
  <div class="meta">
    <div><strong>Документ:</strong> ${escapeHtml(displayDocName)}</div>
    <div><strong>Подготовлено для:</strong> ${layout.meta?.preparedFor || 'Клиент'}</div>
    <div><strong>Аналитик:</strong> ${layout.meta?.preparedBy || 'GPT-5 mini'}</div>
    <div><strong>Дата:</strong> ${layout.meta?.date || generatedAt}</div>
  </div>
  ${summary ? `<div class="block"><h2>Краткое резюме</h2><p>${summary}</p></div>` : ''}
  ${layout.sections?.card?.length ? `<div class="block"><h2>Карточка документа</h2><div class="grid">${layout.sections.card
    .map((item) => `<div>${item}</div>`)
    .join('')}</div></div>` : ''}
  ${layout.sections?.quotes?.length ? `<div class="block"><h2>Ключевые цитаты</h2>${layout.sections.quotes
    .map((quote) => `<div class="quote"><strong>${quote.ref || ''}</strong><div>${quote.text}</div></div>`)
    .join('')}</div>` : ''}
  ${layout.sections?.actions?.length ? `<div class="block"><h2>Действия</h2>${layout.sections.actions
    .map(
      (block, index) => `<h3>${escapeHtml(normalizePriorityLabel(block.priority, index))}</h3>${(block.items || [])
        .map(
          (item) => `<div class="action avoid-break">
              <div><strong>Проблема:</strong> ${item.problem || ''}</div>
              <div><strong>Действие:</strong> ${item.action || ''}</div>
              <div><strong>Почему:</strong> ${item.why || ''}</div>
              ${item.refs?.length ? `<div><strong>Ссылки:</strong> ${item.refs.join(', ')}</div>` : ''}
            </div>`
        )
        .join('')}`
    )
    .join('')}</div>` : ''}
  ${layout.sections?.risks?.length ? `<div class="block"><h2>Риски</h2>${layout.sections.risks
    .map(
      (risk, index) => `<div class="action avoid-break">
        <div><strong>${escapeHtml(normalizeRiskLabel(risk.title, risk.level, index))}</strong></div>
        <div><strong>Последствие:</strong> ${risk.consequence || ''}</div>
        <div><strong>Как исправить:</strong> ${risk.fix || ''}</div>
        ${risk.refs?.length ? `<div><strong>Ссылки:</strong> ${risk.refs.join(', ')}</div>` : ''}
      </div>`
    )
    .join('')}</div>` : ''}
  ${layout.sections?.redlines?.length ? `<div class="block"><h2>Редлайны</h2>${layout.sections.redlines
    .map(
      (red) => `<div class="action avoid-break">
        <div><strong>Текущий текст:</strong> ${red.current || ''}</div>
        <div><strong>Предлагаемая редакция:</strong> ${red.proposal || ''}</div>
        ${red.goal ? `<div><strong>Цель:</strong> ${red.goal}</div>` : ''}
      </div>`
    )
    .join('')}</div>` : ''}
  ${layout.sections?.questions?.length ? `<div class="block"><h2>Вопросы</h2><ol>${layout.sections.questions
    .map((q) => `<li>${q}</li>`)
    .join('')}</ol></div>` : ''}
  ${layout.sections?.readiness ? `<div class="block"><h2>Готовность</h2><p>${layout.sections.readiness}</p></div>` : ''}
  ${layout.sections?.notes?.length ? `<div class="block"><h2>Дополнительные замечания</h2><ul>${layout.sections.notes
    .map((note) => `<li>${note}</li>`)
    .join('')}</ul></div>` : ''}
  ${layout.sections?.source ? `<div class="block"><h2>Источник</h2><p>${layout.sections.source}</p></div>` : ''}
  ${safeSources.length ? `<div class="block"><h2>Внешние источники</h2>${safeSources
    .map((source, index) => {
      const title = escapeHtml(source.title || `Источник ${index + 1}`);
      const url = escapeHtml(source.url ? sanitizeExternalLink(source.url) : '');
      const snippet = escapeHtml(source.snippet || '');
      const publishedAt = escapeHtml(source.publishedAt || '');
      return `<div class="source avoid-break">
        <div class="source-title">${title}${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>` : ''}</div>
        ${publishedAt ? `<div class="source-meta">${publishedAt}</div>` : ''}
        ${snippet ? `<div class="source-snippet">${snippet}</div>` : ''}
      </div>`;
    })
    .join('')}</div>` : ''}
</body>
</html>`;
};

const ContractReviewPage = ({ theme, onToggleTheme }) => {
  const { apiKey } = useApiKey();
  const { gptSettings } = useGptSettings();
  const [fileInfo, setFileInfo] = useState(null);
  const [documentRecord, setDocumentRecord] = useState(null);
  const [triageResult, setTriageResult] = useState(null);
  const [summaryPreview, setSummaryPreview] = useState(null);
  const [answers, setAnswers] = useState({});
  const [freeText, setFreeText] = useState('');
  const [analysisResult, setAnalysisResult] = useState(null);
  const [layoutResult, setLayoutResult] = useState(null);
  const [stage, setStage] = useState('idle');
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const fileInputRef = useRef(null);

  const cloudinaryConfig = gptSettings.analysis?.cloudinary || {};

  const isNewBetaFlow = (gptSettings.analysis?.analysisFlow || 'new-beta') !== 'old';

  const stageMessages = useMemo(() => {
    if (!isNewBetaFlow) {
      return BASE_STAGE_MESSAGES;
    }
    return {
      ...BASE_STAGE_MESSAGES,
      analyzing: {
        ...BASE_STAGE_MESSAGES.analyzing,
        title: 'Шаг 3 — Двухэтапный анализ',
        note:
          'Этап 1/2: gpt-5-mini готовит черновой отчёт. Этап 2/2: gpt-5 с web search проверяет документ и усиливает выводы.'
      },
      'summary-ready': {
        ...BASE_STAGE_MESSAGES['summary-ready'],
        note:
          'Проверьте сводку и ответы. Новый режим выполнит два последовательных запроса: gpt-5-mini → gpt-5 с web search.'
      }
    };
  }, [isNewBetaFlow]);

  const resetState = useCallback(() => {
    setDocumentRecord(null);
    setTriageResult(null);
    setSummaryPreview(null);
    setAnswers({});
    setFreeText('');
    setAnalysisResult(null);
    setLayoutResult(null);
    setFileInfo(null);
    setStage('idle');
    setError('');
    setIsAnalyzing(false);
    setProgressPercent(0);
  }, []);

  const handleBrowse = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  const handleFileChange = useCallback(
    (event) => {
      const file = event.target.files?.[0];
      if (file) {
        event.target.value = '';
        resetState();
        void processFile(file);
      }
    },
    [resetState]
  );

  const processFile = useCallback(
    async (file) => {
      if (!file) return;
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setError(`Файл слишком большой (${prettyBytes(file.size)}). Лимит: ${prettyBytes(MAX_FILE_SIZE_BYTES)}.`);
        appendLogEntry({ level: 'error', scope: 'upload', message: 'Файл превышает лимит размера' });
        return;
      }
      setError('');
      setStage('reading');
      setFileInfo({
        name: file.name,
        size: file.size,
        type: file.type
      });
      try {
        appendLogEntry({ level: 'info', scope: 'upload', message: `Загружаем файл ${file.name}` });
        const record = await readFileContent(file, {
          cloudinary: cloudinaryConfig,
          onLog: appendLogEntry
        });
        setDocumentRecord(record);
        setStage('triage');
      } catch (readError) {
        setError(readError?.message || 'Не удалось обработать файл.');
        appendLogEntry({ level: 'error', scope: 'upload', message: readError?.message || String(readError) });
        setStage('idle');
      }
    },
    [cloudinaryConfig]
  );

  useEffect(() => {
    if (!documentRecord) return;
    if (!apiKey) {
      setError('Укажите API-ключ OpenAI в настройках администратора.');
      setStage('idle');
      return;
    }

    let cancelled = false;

    if (isNewBetaFlow) {
      const runDualStage = async () => {
        try {
          setStage('analyzing');
          setIsAnalyzing(true);
          setTriageResult(null);
          setSummaryPreview(null);
          setAnswers({});
          setFreeText('');
          setAnalysisResult(null);
          setLayoutResult(null);
          appendLogEntry({
            level: 'info',
            scope: 'analysis',
            message: 'Запуск двухэтапного анализа (New Beta)'
          });
          const result = await analyzeDocuments({
            apiKey,
            documents: [documentRecord],
            settings: gptSettings.analysis,
            adaptive: null,
            onLog: appendLogEntry
          });
          if (cancelled) return;
          setAnalysisResult(result);
          appendLogEntry({
            level: 'info',
            scope: 'analysis',
            message: 'Двухэтапный анализ завершён'
          });
          setStage('done');
        } catch (err) {
          if (cancelled) return;
          const message = err?.message || 'Не удалось выполнить анализ.';
          setError(message);
          appendLogEntry({ level: 'error', scope: 'analysis', message });
          setStage('idle');
        } finally {
          if (!cancelled) {
            setIsAnalyzing(false);
          }
        }
      };

      runDualStage();
      return () => {
        cancelled = true;
      };
    }

    const runAdaptive = async () => {
      try {
        setStage('triage');
        appendLogEntry({ level: 'info', scope: 'adaptive', message: 'Запуск адаптивного анализа документа' });
        const triage = await prepareAdaptivePrompt({
          apiKey,
          document: documentRecord,
          settings: gptSettings.analysis,
          onLog: appendLogEntry
        });
        if (cancelled) return;
        setTriageResult(triage);
        appendLogEntry({
          level: 'info',
          scope: 'adaptive',
          message: 'Developer message подготовлен',
          developerPromptLength: triage.developerPrompt?.length || 0
        });
        const summary = await prepareSummaryPreview({
          apiKey,
          document: documentRecord,
          triage,
          settings: gptSettings.analysis,
          onLog: appendLogEntry
        });
        if (cancelled) return;
        setSummaryPreview(summary);
        setAnswers({});
        setFreeText('');
        setStage('summary-ready');
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || 'Не удалось выполнить предварительный анализ.');
        appendLogEntry({ level: 'error', scope: 'adaptive', message: err?.message || String(err) });
        setStage('idle');
      }
    };

    runAdaptive();
    return () => {
      cancelled = true;
    };
  }, [
    apiKey,
    documentRecord,
    gptSettings.analysis,
    isNewBetaFlow
  ]);

  const handleDrop = useCallback(
    (event) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) {
        resetState();
        void processFile(file);
      }
    },
    [processFile, resetState]
  );

  const handleDragOver = useCallback((event) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const handleAnswer = useCallback((questionId, option) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: option
    }));
  }, []);

  const handleStartAnalysis = useCallback(async () => {
    if (!apiKey) {
      setError('Укажите API-ключ OpenAI в настройках администратора.');
      appendLogEntry({ level: 'error', scope: 'analysis', message: 'API-ключ отсутствует' });
      return;
    }
    if (!documentRecord || !triageResult) {
      setError('Сначала загрузите документ и дождитесь предварительного анализа.');
      return;
    }

    const answerLines = [];
    (summaryPreview?.questions || []).forEach((question) => {
      const selected = answers[question.id];
      if (selected) {
        const instruction = selected.instruction ? ` ${selected.instruction}` : '';
        answerLines.push(`${question.question} — ${selected.label}.${instruction}`.trim());
      }
    });
    if (freeText && freeText.trim()) {
      answerLines.push(`Комментарий клиента: ${freeText.trim()}`);
    }

    setIsAnalyzing(true);
    setStage('analyzing');
    setError('');
    try {
      appendLogEntry({ level: 'info', scope: 'analysis', message: 'Отправляем запрос на основной анализ' });
      const result = await analyzeDocuments({
        apiKey,
        documents: [documentRecord],
        settings: gptSettings.analysis,
        adaptive: {
          developerPrompt: triageResult.developerPrompt,
          promptAddendum: triageResult.promptAddendum,
          promptAddendumLines: triageResult.promptAddendumLines,
          summary: triageResult.summary,
          layoutBrief: triageResult.layoutBrief,
          answerInstructions: answerLines,
          questions: triageResult.questions
        },
        onLog: appendLogEntry
      });
      setAnalysisResult(result);
      appendLogEntry({ level: 'info', scope: 'analysis', message: 'Основной анализ завершён' });

      if (result?.reportText) {
        try {
          const layout = await formatAnalysisLayout({
            apiKey,
            reportText: result.reportText,
            documentName: fileInfo?.name || documentRecord?.meta?.originalName || 'Документ',
            layoutBrief: triageResult.layoutBrief,
            summary: triageResult.summary,
            settings: gptSettings.analysis,
            onLog: appendLogEntry
          });
          setLayoutResult(layout);
        } catch (layoutError) {
          appendLogEntry({
            level: 'error',
            scope: 'layout',
            message: layoutError?.message || 'Ошибка форматирования отчёта'
          });
          setLayoutResult(null);
        }
      }

      setStage('done');
    } catch (analysisError) {
      setError(analysisError?.message || 'Не удалось выполнить анализ.');
      appendLogEntry({ level: 'error', scope: 'analysis', message: analysisError?.message || String(analysisError) });
      setStage('summary-ready');
    } finally {
      setIsAnalyzing(false);
    }
  }, [
    answers,
    apiKey,
    documentRecord,
    fileInfo?.name,
    freeText,
    gptSettings.analysis,
    summaryPreview?.questions,
    triageResult
  ]);

  const handleDownloadLayout = useCallback(() => {
    if (!layoutResult?.layout) return;
    const html = buildLayoutHtml(
      layoutResult.layout,
      layoutResult?.layout?.layout?.hint || '',
      analysisResult?.sources || []
    );
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(fileInfo?.name || 'report').replace(/\.[^.]+$/, '')}-layout.html`;
    link.click();
    URL.revokeObjectURL(url);
    appendLogEntry({ level: 'info', scope: 'layout', message: 'Скачан оформленный отчёт' });
  }, [analysisResult?.sources, fileInfo?.name, layoutResult?.layout]);

  const handlePrintLayout = useCallback(() => {
    if (!layoutResult?.layout) return;
    const html = buildLayoutHtml(
      layoutResult.layout,
      layoutResult?.layout?.layout?.hint || '',
      analysisResult?.sources || []
    );
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
    }
  }, [analysisResult?.sources, layoutResult?.layout]);

  const handleResetWorkflow = useCallback(() => {
    resetState();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [resetState]);

  const themeClass = getThemeClass(theme);
  const summaryReady = stage === 'summary-ready';
  const showUploadCard = stage === 'idle';
  const stageInfo = stageMessages[stage] || null;
  const StageIcon = stageInfo?.icon || null;
  const targetProgress = useMemo(() => STAGE_PROGRESS[stage] ?? 0, [stage]);
  const roundedProgress = Math.max(0, Math.min(100, Math.round(progressPercent)));

  useEffect(() => {
    if (!Number.isFinite(targetProgress)) {
      return;
    }
    if (stage === 'idle') {
      setProgressPercent(0);
      return;
    }
    if (Math.abs(progressPercent - targetProgress) <= 1) {
      setProgressPercent(targetProgress);
      return;
    }
    if (typeof window === 'undefined') {
      setProgressPercent(targetProgress);
      return;
    }
    const timeout = window.setTimeout(() => {
      setProgressPercent((prev) => {
        if (!Number.isFinite(prev)) {
          return targetProgress;
        }
        const diff = targetProgress - prev;
        if (Math.abs(diff) <= 1) {
          return targetProgress;
        }
        const step = diff * 0.25;
        const next = prev + step;
        if (diff > 0) {
          return next > targetProgress ? targetProgress : next;
        }
        return next < targetProgress ? targetProgress : next;
      });
    }, 80);
    return () => window.clearTimeout(timeout);
  }, [progressPercent, stage, targetProgress]);

  const currentFileName = fileInfo?.name || documentRecord?.meta?.originalName || '';
  const displayFileName = formatDisplayFileName(currentFileName);
  const webSources = analysisResult?.sources || [];

  const stepStatus = useCallback(
    (step) => {
      switch (step) {
        case 1:
          if (stage === 'idle') return 'todo';
          if (stage === 'reading') return 'active';
          return 'done';
        case 2:
          if (stage === 'triage') return 'active';
          if (stage === 'summary-ready' || stage === 'analyzing' || stage === 'formatting' || stage === 'done')
            return 'done';
          return 'todo';
        case 3:
          if (stage === 'analyzing') return 'active';
          if (stage === 'formatting' || stage === 'done') return 'done';
          return 'todo';
        case 4:
          if (stage === 'formatting') return 'active';
          if (stage === 'done' && layoutResult) return 'done';
          if (stage === 'done') return 'active';
          return 'todo';
        default:
          return 'todo';
      }
    },
    [layoutResult, stage]
  );

  const progressSteps = useMemo(() => {
    if (isNewBetaFlow) {
      const prepStatus = stage === 'idle' ? 'todo' : stage === 'reading' ? 'active' : 'done';
      const analysisStatus = stage === 'analyzing' ? 'active' : stage === 'done' ? 'done' : 'todo';
      return [
        { index: 1, label: 'Подготовка', status: prepStatus },
        {
          index: 2,
          label: 'Двухэтапный анализ (gpt-5-mini → gpt-5 + web search)',
          status: analysisStatus
        }
      ];
    }
    return [
      { index: 1, label: 'Подготовка', status: stepStatus(1) },
      { index: 2, label: 'Предварительный анализ', status: stepStatus(2) },
      { index: 3, label: 'Глубокий анализ', status: stepStatus(3) },
      { index: 4, label: 'Оформление', status: stepStatus(4) }
    ];
  }, [isNewBetaFlow, stage, stepStatus]);

  return (
    <div className={`negve-page ${themeClass}`} data-theme={themeClass}>
      <div className="negve-page__decor negve-page__decor--primary" />
      <div className="negve-page__decor negve-page__decor--secondary" />

      <header className="negve-header">
        <div className="negve-header__brand">
          <div className="negve-header__logo" style={{ background: ACCENT_COLOR }} />
          <div>
            <div className="negve-header__title">DOKNEG Optima</div>
            <div className="negve-header__subtitle">AI-досье юридических документов</div>
          </div>
        </div>
        <div className="negve-header__actions">
          <button type="button" className="negve-button negve-button--ghost" onClick={onToggleTheme}>
            {themeClass === 'dark' ? (
              <>
                <Sun className="negve-icon" /> Светлая тема
              </>
            ) : (
              <>
                <Moon className="negve-icon" /> Тёмная тема
              </>
            )}
          </button>
          <a href="/admin77" className="negve-button negve-button--ghost">
            <ArrowRight className="negve-icon" /> Админ-панель
          </a>
        </div>
      </header>

      <main className="negve-main">
        <section className="negve-hero">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            {isNewBetaFlow
              ? 'Анализ юридических документов в два шага (2 запроса к GPT)'
              : 'Анализ юридических документов в три шага'}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
          >
            {isNewBetaFlow
              ? 'Загрузите договор или иной документ — gpt-5-mini подготовит детальный черновик, затем gpt-5 с web search усилит выводы и вернёт финальный отчёт.'
              : 'Загрузите договор или иной документ, получите уточняющие вопросы, глубокий анализ и оформленный отчёт готовый для печати.'}
          </motion.p>
        </section>

        <AnimatePresence>
          {showUploadCard && (
            <motion.section
              className="negve-upload"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <div
                className={`negve-card negve-upload-card ${isDragging ? 'negve-upload-card--drag' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="negve-upload-card__header">
                  <span className="negve-upload-card__step">Шаг 1. Загрузка</span>
                </div>
                <div className="negve-upload-card__body">
                  <div className="negve-upload-card__icon">
                    <UploadCloud className="negve-upload-card__icon-svg" />
                  </div>
                  <div className="negve-upload-card__content">
                    <div className="negve-upload-card__title">Загрузите документ</div>
                    <p className="negve-upload-card__subtitle">
                      Перетащите файл или нажмите «Выбрать файл». Поддерживаем PDF, DOCX, PNG и JPG размером до
                      {` ${prettyBytes(MAX_FILE_SIZE_BYTES)}.`}
                    </p>
                    <div className="negve-upload-card__actions">
                      <button type="button" className="negve-button" onClick={handleBrowse}>
                        Выбрать файл
                      </button>
                      <span className="negve-upload-card__hint">или отпустите его в этой области</span>
                    </div>
                    <div className="negve-upload-card__meta">
                      <span>PDF / DOCX / PNG / JPG</span>
                      <span>До {prettyBytes(MAX_FILE_SIZE_BYTES)}</span>
                      <span>Шифрование при загрузке</span>
                    </div>
                  </div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="negve-upload__input"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                  onChange={handleFileChange}
                />
                {error && <div className="negve-alert negve-alert--error">{error}</div>}
                {!apiKey && (
                  <div className="negve-alert negve-alert--warning">
                    API-ключ не задан. Откройте административную панель, чтобы указать OPENAI_API_KEY.
                  </div>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {stage !== 'idle' && stage !== 'done' && (
            <motion.section
              className="negve-status"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
            >
              <div className="negve-card negve-card--progress">
                <div className="negve-card__header negve-card__header--compact">
                  <div className="negve-card__title">Статус обработки</div>
                  <div className="negve-card__subtitle">{formatDateTime(Date.now())}</div>
                </div>
                <div className="negve-progress">
                  <div className="negve-progress__header">
                    <span>Прогресс</span>
                    <span className="negve-progress__percent">{roundedProgress}%</span>
                  </div>
                  <div
                    className="negve-progress__track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={roundedProgress}
                  >
                    <div className="negve-progress__fill" style={{ width: `${roundedProgress}%` }} />
                  </div>
                </div>
                <div className="negve-progress__steps">
                  {progressSteps.map((item) => (
                    <Step key={item.index} index={item.index} label={item.label} status={item.status} />
                  ))}
                </div>
                {fileInfo && (
                  <div className="negve-status__file">
                    <span className="negve-status__file-name" title={fileInfo.name}>
                      {displayFileName || fileInfo.name}
                    </span>
                    <span className="negve-status__file-size">{formatFileSize(fileInfo.size)}</span>
                  </div>
                )}
                {stageInfo && StageIcon && (
                  <div className="negve-status__hint">
                    <StageIcon
                      className={`negve-status__hint-icon ${stageInfo.spinning ? 'negve-status__hint-icon--spin' : ''}`}
                    />
                    <div>
                      <div className="negve-status__hint-title">{stageInfo.title}</div>
                      <div className="negve-status__hint-note">{stageInfo.note}</div>
                    </div>
                  </div>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {summaryReady && summaryPreview && (
          <SummaryPreview
            summaryPoints={summaryPreview.summaryPoints}
            questions={summaryPreview.questions}
            answers={answers}
            onAnswer={handleAnswer}
            freeText={freeText}
            onFreeText={setFreeText}
            freeTextMeta={summaryPreview.freeText}
          />
        )}

        {summaryReady && (
          <div className="negve-card negve-card--actions">
            <div className="negve-card__header negve-card__header--compact">
              <div>
                <div className="negve-card__title">Шаг 2. Подтвердите старт глубокого анализа</div>
                <div className="negve-card__subtitle">
                  {isNewBetaFlow
                    ? 'GPT выполнит две итерации: сначала gpt-5-mini подготовит черновик, затем gpt-5 с web search усилит отчёт.'
                    : 'GPT учтёт выбранные ответы и комментарии при подготовке отчёта'}
                </div>
              </div>
              <div className="negve-card__header-actions">
                <button
                  type="button"
                  className="negve-button negve-button--primary"
                  onClick={handleStartAnalysis}
                  disabled={isAnalyzing}
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="negve-icon negve-icon--spin" /> Анализируем…
                    </>
                  ) : (
                    <>
                      <ArrowRight className="negve-icon" />{' '}
                      {isNewBetaFlow ? 'Запустить двухэтапный анализ' : 'Начать анализ'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {stage === 'formatting' && (
          <div className="negve-card negve-card--progress">
            <div className="negve-card__header negve-card__header--compact">
              <div className="negve-card__title">Формируем финальный отчёт</div>
              <div className="negve-card__subtitle">
                Процесс может занять до 2 минут в зависимости от объёма документа
              </div>
            </div>
            <div className="negve-progress negve-progress--pulse">
              <div className="negve-progress__header">
                <span>Оформление</span>
                <span className="negve-progress__percent">{roundedProgress}%</span>
              </div>
              <div
                className="negve-progress__track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={roundedProgress}
              >
                <div className="negve-progress__fill" style={{ width: `${roundedProgress}%` }} />
              </div>
              <Loader2 className="negve-progress__spinner" />
            </div>
          </div>
        )}

        {stage === 'done' && (
          <section className="negve-results">
            {analysisResult?.reportText && (
              <div className="negve-card negve-card--result">
                <div className="negve-card__header">
                  <div>
                    <div className="negve-card__title">
                      {isNewBetaFlow
                        ? 'Финальный текст (этап 2 — GPT-5 + web search)'
                        : 'Финальный текст анализа'}
                    </div>
                    <div className="negve-card__subtitle">
                      {isNewBetaFlow
                        ? 'Это ответ второго запроса. Используйте его напрямую или передайте в модуль оформления.'
                        : 'Используйте отчёт для подготовки итогового документа.'}
                    </div>
                  </div>
                </div>
                <div className="negve-card__block" style={{ maxHeight: '420px', overflowY: 'auto' }}>
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    <LinkifiedText text={analysisResult.reportText} />
                  </div>
                </div>
              </div>
            )}
            {isNewBetaFlow && analysisResult?.stages?.initial?.reportText && (
              <div className="negve-card negve-card--result">
                <details>
                  <summary>
                    Черновой отчёт (этап 1 — {analysisResult.stages.initial.model || 'gpt-5-mini'})
                  </summary>
                  <div style={{ marginTop: '12px', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    <LinkifiedText text={analysisResult.stages.initial.reportText} />
                  </div>
                </details>
              </div>
            )}
            {!isNewBetaFlow ? (
              <div className="negve-card negve-card--result">
                <div className="negve-card__header">
                  <div>
                    <div className="negve-card__title">Итоговый отчёт</div>
                    <div className="negve-card__subtitle">Карточная презентация, готовая для отправки и печати</div>
                  </div>
                  <div className="negve-card__header-actions">
                    <button
                      type="button"
                      className="negve-button negve-button--ghost"
                      onClick={handleDownloadLayout}
                      disabled={!layoutResult?.layout}
                    >
                      <Download className="negve-icon" /> Скачать HTML
                    </button>
                    <button
                      type="button"
                      className="negve-button negve-button--ghost"
                      onClick={handlePrintLayout}
                      disabled={!layoutResult?.layout}
                    >
                      <Printer className="negve-icon" /> Печать
                    </button>
                  </div>
                </div>
                <div className="negve-card__block">
                  {layoutResult?.layout ? (
                    <LayoutReport
                      layout={layoutResult.layout}
                      fallbackHint={triageResult?.layoutBrief || ''}
                      sources={webSources}
                    />
                  ) : (
                    <div className="negve-placeholder">Не удалось сформировать макет отчёта.</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="negve-card negve-card--result">
                <div className="negve-card__header">
                  <div>
                    <div className="negve-card__title">Оформление отключено</div>
                    <div className="negve-card__subtitle">
                      Новый режим выполняет только два запроса к GPT. При необходимости запустите форматирование вручную в старом режиме.
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="negve-results__footer">
              <button type="button" className="negve-button negve-button--ghost" onClick={handleResetWorkflow}>
                <ArrowRight className="negve-icon" /> Новый анализ
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default ContractReviewPage;
