import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpenCheck, Cloud, FileText, LogOut, RefreshCw, Save, ScrollText, Shield, Trash2 } from 'lucide-react';
import { useApiKey } from '../hooks/useApiKey.js';
import { useGptSettings } from '../hooks/useGptSettings.js';
import { getThemeClass } from '../hooks/useTheme.js';

const LOG_STORAGE_KEY = 'dokneg-optima:analysis-log';
const REASONING_OPTIONS = [
  { value: '', label: 'Авто' },
  { value: 'low', label: 'Низкое' },
  { value: 'medium', label: 'Среднее' },
  { value: 'high', label: 'Максимальное' }
];

const TABS = [
  {
    id: 'general',
    icon: Cloud,
    title: 'Подключения',
    description: 'API-ключ и Cloudinary'
  },
  {
    id: 'prompts',
    icon: BookOpenCheck,
    title: 'Промты и модели',
    description: 'Настройка трёх шагов анализа'
  },
  {
    id: 'logs',
    icon: ScrollText,
    title: 'Журнал',
    description: 'Последние операции'
  }
];

const readLogs = () => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.reverse() : [];
  } catch (error) {
    return [];
  }
};

const getNestedValue = (source, path, fallback = '') => {
  if (!source) return fallback;
  return path.split('.').reduce((acc, key) => {
    if (acc && Object.prototype.hasOwnProperty.call(acc, key)) {
      return acc[key];
    }
    return fallback;
  }, source);
};

const updateNestedValue = (source, path, value) => {
  const segments = path.split('.');
  const next = { ...source };
  let cursor = next;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    cursor[key] = { ...(cursor[key] || {}) };
    cursor = cursor[key];
  }
  cursor[segments[segments.length - 1]] = value;
  return next;
};

const DocumentAnalysisAdminPage = ({ theme, onToggleTheme }) => {
  const themeClass = getThemeClass(theme);
  const { apiKey, setApiKey } = useApiKey();
  const { gptSettings, setGptSettings, resetSettings } = useGptSettings();

  const [activeTab, setActiveTab] = useState('general');
  const [draft, setDraft] = useState(gptSettings.analysis);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('saved'); // saved | dirty | saving
  const [logs, setLogs] = useState(() => readLogs());

  useEffect(() => {
    setDraft(gptSettings.analysis);
    setDirty(false);
    setStatus('saved');
  }, [gptSettings]);

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === LOG_STORAGE_KEY) {
        setLogs(readLogs());
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const updateDraft = (path, value) => {
    setDraft((prev) => updateNestedValue(prev, path, value));
    setDirty(true);
    setStatus('dirty');
  };

  const handleToggle = (path) => (event) => {
    updateDraft(path, event.target.checked);
  };

  const handleInput = (path) => (event) => {
    updateDraft(path, event.target.value);
  };

  const handleTextarea = (path) => (event) => {
    updateDraft(path, event.target.value);
  };

  const handleReasoning = (path) => (event) => {
    updateDraft(path, event.target.value);
  };

  const handleSave = () => {
    setStatus('saving');
    setGptSettings((prev) => ({
      ...prev,
      analysis: draft
    }));
  };

  const handleCancel = () => {
    setDraft(gptSettings.analysis);
    setDirty(false);
    setStatus('saved');
  };

  const handleReset = () => {
    resetSettings();
    setLogs(readLogs());
  };

  const refreshLogs = () => {
    setLogs(readLogs());
  };

  const clearLogs = () => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(LOG_STORAGE_KEY);
    refreshLogs();
  };

  const summaryCards = useMemo(
    () => [
      {
        title: 'Шаг 1 — Developer message',
        description:
          'GPT-5 mini анализирует документ, определяет тип, юрисдикцию и формирует персонализированный developer prompt.',
        modelPath: 'preAnalysisModel',
        webSearchPath: 'preAnalysisWebSearchEnabled',
        reasoningPath: 'preAnalysisReasoningEffort',
        promptPath: 'prompts.preAnalysis'
      },
      {
        title: 'Шаг 2 — Сводка и вопросы',
        description: 'Создание краткой сводки и списка уточняющих вопросов для оператора.',
        modelPath: 'summaryModel',
        webSearchPath: 'summaryWebSearchEnabled',
        reasoningPath: 'summaryReasoningEffort',
        promptPath: 'prompts.summary'
      },
      {
        title: 'Шаг 3 — Основной анализ',
        description: 'Глубокий отчёт по универсальной структуре с цитатами и действиями.',
        modelPath: 'analysisModel',
        webSearchPath: 'analysisWebSearchEnabled',
        reasoningPath: 'analysisReasoningEffort',
        promptPath: 'prompts.analysis',
        developerToggle: 'developerPromptFromTriage'
      },
      {
        title: 'Шаг 4 — Оформление отчёта',
        description: 'Преобразование текста в карточный макет с акцентами.',
        modelPath: 'layoutModel',
        webSearchPath: 'layoutWebSearchEnabled',
        reasoningPath: 'layoutReasoningEffort',
        promptPath: 'prompts.layout'
      }
    ],
    []
  );

  const renderGeneralTab = () => (
    <div className="admin-panel__sections">
      <div className="admin-card">
        <div className="admin-card__header">
          <div className="admin-card__icon admin-card__icon--accent">
            <Shield size={18} />
          </div>
          <div>
            <h2>OpenAI API</h2>
            <p>Ключ хранится локально в браузере.</p>
          </div>
        </div>
        <div className="admin-card__body admin-card__body--stack">
          <div className="admin-field">
            <span>OPENAI_API_KEY</span>
            <input
              type="password"
              value={apiKey}
              placeholder="sk-..."
              onChange={(event) => setApiKey(event.target.value.trim())}
            />
            <small>
              Без ключа GPT не сможет выполнять анализ. Ключ никогда не отправляется на сервер приложения.
            </small>
          </div>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card__header">
          <div className="admin-card__icon admin-card__icon--neutral">
            <Cloud size={18} />
          </div>
          <div>
            <h2>Cloudinary</h2>
            <p>Используется для генерации изображений страниц и архивов.</p>
          </div>
        </div>
        <div className="admin-card__body admin-card__body--grid">
          <div className="admin-field">
            <span>Cloud name</span>
            <input value={draft.cloudinary?.cloudName || ''} onChange={handleInput('cloudinary.cloudName')} />
          </div>
          <div className="admin-field">
            <span>Upload preset</span>
            <input value={draft.cloudinary?.uploadPreset || ''} onChange={handleInput('cloudinary.uploadPreset')} />
            <small>Либо задайте пару API key / API secret.</small>
          </div>
          <div className="admin-field">
            <span>API key</span>
            <input value={draft.cloudinary?.apiKey || ''} onChange={handleInput('cloudinary.apiKey')} />
          </div>
          <div className="admin-field">
            <span>API secret</span>
            <input value={draft.cloudinary?.apiSecret || ''} onChange={handleInput('cloudinary.apiSecret')} />
          </div>
          <div className="admin-field">
            <span>Папка</span>
            <input value={draft.cloudinary?.folder || ''} onChange={handleInput('cloudinary.folder')} />
          </div>
          <div className="admin-field admin-field--toggle">
            <span>Загружать оригинал</span>
            <label className="admin-toggle">
              <input
                type="checkbox"
                checked={Boolean(draft.cloudinary?.uploadOriginalFile)}
                onChange={handleToggle('cloudinary.uploadOriginalFile')}
              />
              <span />
            </label>
            <small>Оригинальный файл будет сохраняться в облаке вместе с изображениями страниц.</small>
          </div>
        </div>
      </div>
    </div>
  );

  const renderPromptsTab = () => (
    <div className="admin-panel__sections">
      <div className="admin-card">
        <div className="admin-card__header">
          <div className="admin-card__icon admin-card__icon--accent">
            <Shield size={18} />
          </div>
          <div>
            <h2>Режим анализа</h2>
            <p>Переключение между новым двухэтапным анализом и предыдущей схемой.</p>
          </div>
        </div>
        <div className="admin-card__body admin-card__body--stack">
          <div className="admin-field">
            <span>Variant</span>
            <select value={draft.analysisFlow || 'new-beta'} onChange={handleInput('analysisFlow')}>
              <option value="new-beta">New Beta — два запроса (gpt-5-mini → gpt-5)</option>
              <option value="old">Old — один запрос (только текущая модель)</option>
            </select>
            <small>
              New Beta сначала строит глубокий черновой отчёт, затем усиливает его моделью GPT-5 с web search.
              При необходимости можно вернуть прошлую реализацию одним переключателем.
            </small>
          </div>
        </div>
      </div>
      {summaryCards.map((card) => {
        const StageIcon = card.developerToggle ? FileText : FileText;
        const webSearchEnabled = draft[card.webSearchPath];
        const developerToggleChecked = card.developerToggle ? Boolean(draft[card.developerToggle]) : false;
        return (
          <div className="admin-card" key={card.title}>
            <div className="admin-card__header">
              <div className="admin-card__icon admin-card__icon--neutral">
                <StageIcon size={18} />
              </div>
              <div>
                <h2>{card.title}</h2>
                <p>{card.description}</p>
              </div>
            </div>
            <div className="admin-card__body admin-card__body--grid">
              <div className="admin-field">
                <span>Модель</span>
                <input value={draft[card.modelPath] || ''} onChange={handleInput(card.modelPath)} />
              </div>
              <div className="admin-field admin-field--toggle">
                <span>Web search</span>
                <label className="admin-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(webSearchEnabled)}
                    onChange={handleToggle(card.webSearchPath)}
                  />
                  <span />
                </label>
                <small>При включении модель сможет обращаться к web-поиску OpenAI.</small>
              </div>
              <div className="admin-field">
                <span>Reasoning effort</span>
                <select value={draft[card.reasoningPath] || ''} onChange={handleReasoning(card.reasoningPath)}>
                  {REASONING_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {card.developerToggle && (
                <div className="admin-field admin-field--toggle">
                  <span>Использовать developer prompt из шага 1</span>
                  <label className="admin-toggle">
                    <input
                      type="checkbox"
                      checked={developerToggleChecked}
                      onChange={handleToggle(card.developerToggle)}
                    />
                    <span />
                  </label>
                  <small>При включении текст ниже будет заблокирован, а GPT возьмёт persona из предварительного анализа.</small>
                </div>
              )}
            </div>
            <div className="admin-card__body admin-card__body--stack">
              <div className="admin-field" aria-disabled={card.developerToggle && developerToggleChecked}>
                <span>Prompt</span>
                <textarea
                  rows={card.developerToggle ? 14 : 10}
                  value={getNestedValue(draft, card.promptPath) || ''}
                  onChange={handleTextarea(card.promptPath)}
                  disabled={card.developerToggle && developerToggleChecked}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderLogsTab = () => (
    <div className="admin-panel__sections">
      <div className="admin-card">
        <div className="admin-card__header">
          <div className="admin-card__icon admin-card__icon--accent">
            <ScrollText size={18} />
          </div>
          <div>
            <h2>Журнал операций</h2>
            <p>Последние события клиента хранятся локально в браузере.</p>
          </div>
        </div>
        <div className="admin-card__body admin-card__body--stack">
          <div className="admin-actions">
            <button type="button" className="admin-button" onClick={refreshLogs}>
              <RefreshCw size={14} /> Обновить
            </button>
            <button type="button" className="admin-button admin-button--ghost" onClick={clearLogs}>
              <Trash2 size={14} /> Очистить журнал
            </button>
          </div>
          <div className="admin-results">
            {logs.length === 0 ? (
              <p>Записей нет. Выполните анализ, чтобы посмотреть события.</p>
            ) : (
              <ul>
                {logs.map((entry, index) => (
                  <li key={`${entry.at || index}-${index}`}>
                    <strong>{formatDate(entry.at)}</strong>
                    <span>{entry.scope ? ` • ${entry.scope}` : ''}</span>
                    <div>{entry.message}</div>
                    {(() => {
                      const metaItems = [];
                      if (entry.model) metaItems.push(`Модель: ${entry.model}`);
                      if (typeof entry.webSearch !== 'undefined') {
                        metaItems.push(`Web search: ${entry.webSearch ? 'включён' : 'выключен'}`);
                      }
                      if (entry.reasoning) metaItems.push(`Reasoning: ${entry.reasoning}`);
                      const tokens = Number(entry.tokens);
                      if (Number.isFinite(tokens) && tokens > 0) metaItems.push(`Токены: ${tokens}`);
                      const textLength = Number(entry.textLength);
                      if (Number.isFinite(textLength) && textLength > 0) {
                        metaItems.push(`Текст: ${textLength}`);
                      }
                      if (entry.attachments?.length) {
                        metaItems.push(`Вложения: ${entry.attachments.length}`);
                      }
                      if (!metaItems.length) return null;
                      return (
                        <div className="admin-log__meta">
                          {metaItems.map((item) => (
                            <span key={item}>{item}</span>
                          ))}
                        </div>
                      );
                    })()}
                    {Array.isArray(entry.attachments) && entry.attachments.length > 0 && (
                      <ul className="admin-log__attachments">
                        {entry.attachments.map((item, attachmentIndex) => (
                          <li key={`${attachmentIndex}-${item}`}>{item}</li>
                        ))}
                      </ul>
                    )}
                    {entry.outputPreview && (
                      <pre className="admin-log__preview">{entry.outputPreview}</pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const formatDate = (value) => {
    if (!value) return '';
    try {
      return new Date(value).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return value;
    }
  };

  return (
    <div className={`admin-shell ${themeClass}`} data-theme={themeClass}>
      <header className="admin-shell__header">
        <div className="admin-shell__brand">
          <div className="admin-shell__logo" />
          <div>
            <h1>DOKNEG Optima — Администрирование</h1>
            <p>Настройте цепочку анализа и мониторинг.</p>
          </div>
        </div>
        <div className="admin-shell__tools">
          <button type="button" className="admin-link" onClick={onToggleTheme}>
            Тема: {themeClass === 'dark' ? 'Тёмная' : 'Светлая'}
          </button>
          <a className="admin-link" href="/">
            <LogOut size={14} /> Вернуться к анализу
          </a>
        </div>
      </header>

      <div className="admin-shell__layout">
        <nav className="admin-shell__nav">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={`admin-tab ${active ? 'admin-tab--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <div className="admin-tab__icon">
                  <Icon size={18} />
                </div>
                <div className="admin-tab__text">
                  <strong>{tab.title}</strong>
                  <small>{tab.description}</small>
                </div>
              </button>
            );
          })}
        </nav>

        <main className="admin-shell__content">
          <motion.div
            className="admin-toolbar"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div
              className={`admin-toolbar__status ${
                status === 'saving'
                  ? 'admin-toolbar__status--saving'
                  : status === 'dirty'
                  ? 'admin-toolbar__status--dirty'
                  : 'admin-toolbar__status--saved'
              }`}
            >
              {status === 'saving' ? 'Сохраняем…' : status === 'dirty' ? 'Есть несохранённые изменения' : 'Все изменения сохранены'}
            </div>
            <div className="admin-toolbar__buttons">
              <button type="button" className="admin-button admin-button--ghost" onClick={handleReset}>
                <Shield size={14} /> Сбросить по умолчанию
              </button>
              <button type="button" className="admin-button admin-button--ghost" onClick={handleCancel} disabled={!dirty}>
                Отменить
              </button>
              <button type="button" className="admin-button" onClick={handleSave} disabled={!dirty}>
                <Save size={14} /> Сохранить
              </button>
            </div>
          </motion.div>

          {activeTab === 'general' && renderGeneralTab()}
          {activeTab === 'prompts' && renderPromptsTab()}
          {activeTab === 'logs' && renderLogsTab()}
        </main>
      </div>
    </div>
  );
};

export default DocumentAnalysisAdminPage;
