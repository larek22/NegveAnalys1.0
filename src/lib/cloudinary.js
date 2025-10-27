const sanitizePublicId = (value) => {
  if (!value) return '';
  return String(value)
    .replace(/[^a-zA-Z0-9/_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
};

const toHex = (buffer) => Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');

const sha1Hex = async (input) => {
  if (!input) return '';
  const text = typeof input === 'string' ? input : String(input);
  if (typeof crypto !== 'undefined' && crypto?.subtle) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-1', data);
    return toHex(digest);
  }
  if (typeof window === 'undefined' && typeof globalThis !== 'undefined') {
    try {
      const { createHash } = await import('crypto');
      return createHash('sha1').update(text).digest('hex');
    } catch (error) {
      // ignore and fall through
    }
  }
  throw new Error('SHA-1 недоступен в этом окружении — попробуйте другой браузер или включите HTTPS.');
};

const buildSignatureBase = (params = {}) => {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : String(value)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([key, value]) => `${key}=${value}`).join('&');
};

export const createCloudinarySignature = async (params, apiSecret) => {
  if (!apiSecret) {
    throw new Error('Cloudinary API secret отсутствует.');
  }
  const base = buildSignatureBase(params);
  return sha1Hex(`${base}${apiSecret}`);
};

export const testCloudinaryConnection = async (config = {}) => {
  if (typeof FormData === 'undefined') {
    throw new Error('FormData недоступен в этом окружении. Запустите тест из браузера.');
  }
  if (!config?.cloudName) {
    throw new Error('Укажите Cloud name.');
  }
  const resourceType = (config.resourceType || 'auto').trim() || 'auto';
  const endpoint = `https://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/upload`;
  const form = new FormData();
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = sanitizePublicId(`connection-test-${timestamp}`) || `connection-test-${timestamp}`;
  const tags = 'connection_test';

  form.append('file', 'data:text/plain;base64,UElORw==');
  form.append('public_id', publicId);

  if (config.folder) {
    form.append('folder', config.folder);
  }
  form.append('tags', tags);

  const hasSignature = config.apiKey && config.apiSecret;
  if (hasSignature) {
    const signatureParams = {
      public_id: publicId,
      timestamp,
      tags,
      folder: config.folder || undefined
    };
    const signature = await createCloudinarySignature(signatureParams, config.apiSecret);
    form.append('api_key', config.apiKey);
    form.append('timestamp', String(timestamp));
    form.append('signature', signature);
  } else if (config.uploadPreset) {
    form.append('upload_preset', config.uploadPreset);
  } else {
    throw new Error('Укажите upload preset либо пару API key/API secret.');
  }

  const response = await fetch(endpoint, { method: 'POST', body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Cloudinary не ответил: ${message}`);
  }

  return {
    url: payload?.secure_url || payload?.url || '',
    publicId: payload?.public_id || publicId,
    bytes: payload?.bytes || 0,
    resourceType: payload?.resource_type || resourceType
  };
};

export const uploadDataUrlToCloudinary = async ({
  dataUrl,
  fileName,
  config,
  resourceType = 'auto',
  tags = [],
  log
}) => {
  if (!config || !config.cloudName) {
    return null;
  }
  if (typeof FormData === 'undefined') {
    if (typeof log === 'function') {
      log('FormData недоступен в окружении — пропускаем загрузку', 'warn', { scope: 'cloudinary' });
    }
    return null;
  }
  if (!dataUrl) {
    return null;
  }

  const hasSignature = Boolean(config.apiKey && config.apiSecret);
  const hasPreset = Boolean(config.uploadPreset);

  if (!hasSignature && !hasPreset) {
    if (typeof log === 'function') {
      log('Cloudinary не настроен: требуется upload preset или пара ключ/секрет', 'warn', { scope: 'cloudinary' });
    }
    return null;
  }

  const type = (resourceType || config.resourceType || 'auto').trim() || 'auto';
  const endpoint = `https://api.cloudinary.com/v1_1/${config.cloudName}/${type}/upload`;

  try {
    const form = new FormData();
    form.append('file', dataUrl);
    const normalizedTags = Array.isArray(tags) && tags.length ? tags.join(',') : '';
    const publicId = fileName ? sanitizePublicId(fileName) : '';

    if (hasSignature) {
      const timestamp = Math.floor(Date.now() / 1000);
      const signatureParams = {
        timestamp,
        public_id: publicId || undefined,
        folder: config.folder || undefined,
        tags: normalizedTags || undefined
      };
      const signature = await createCloudinarySignature(signatureParams, config.apiSecret);
      form.append('api_key', config.apiKey);
      form.append('timestamp', String(timestamp));
      form.append('signature', signature);
      if (publicId) {
        form.append('public_id', publicId);
      }
      if (config.folder) {
        form.append('folder', config.folder);
      }
      if (normalizedTags) {
        form.append('tags', normalizedTags);
      }
    } else {
      form.append('upload_preset', config.uploadPreset);
      if (config.folder) {
        form.append('folder', config.folder);
      }
      if (normalizedTags) {
        form.append('tags', normalizedTags);
      }
      if (publicId) {
        form.append('public_id', publicId);
      }
    }

    const response = await fetch(endpoint, { method: 'POST', body: form });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (typeof log === 'function') {
        log('Cloudinary upload failed', 'warn', {
          scope: 'cloudinary',
          status: response.status,
          error: payload?.error?.message || response.statusText
        });
      }
      return null;
    }

    if (typeof log === 'function') {
      log('Cloudinary upload complete', 'info', {
        scope: 'cloudinary',
        publicId: payload?.public_id || null
      });
    }

    return {
      url: payload?.secure_url || payload?.url || '',
      publicId: payload?.public_id || null,
      bytes: payload?.bytes || null,
      format: payload?.format || null,
      resourceType: payload?.resource_type || type,
      deliveryType: payload?.type || 'upload'
    };
  } catch (error) {
    if (typeof log === 'function') {
      log('Cloudinary upload error', 'error', { scope: 'cloudinary', error: error?.message || String(error) });
    }
    return null;
  }
};

export const cloudinaryUtils = {
  sanitizePublicId,
  createCloudinarySignature,
  testCloudinaryConnection,
  uploadDataUrlToCloudinary
};

export default cloudinaryUtils;
