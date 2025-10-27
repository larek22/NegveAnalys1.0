/**
 * Telegram helper utilities.
 *
 * Only the `formatFileSize` helper is currently required by the UI, so the
 * legacy contract parsing utilities have been removed. When we need them again
 * we can restore them from version control or re-introduce them in a dedicated
 * module.
 */

/**
 * Format a file size using a human-friendly string in Russian locale.
 *
 * @param {number} bytes - Raw file size in bytes.
 * @returns {string} Formatted representation, e.g. `2,4 МБ`.
 */
export const formatFileSize = (bytes) => {
  if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes < 0) {
    return '0 Б';
  }

  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;

  return `${value.toLocaleString('ru-RU', {
    maximumFractionDigits: index === 0 ? 0 : 1
  })} ${units[index]}`;
};
