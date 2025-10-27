import express from 'express';
import cors from 'cors';

const app = express();

const resolveAllowedOrigins = () => {
  const raw = process.env.ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGINS || '';
  if (!raw) return ['*'];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const allowedOrigins = resolveAllowedOrigins();
const allowAll = allowedOrigins.includes('*');

app.use(
  cors({
    origin: (origin, callback) => {
      if (allowAll || !origin || allowedOrigins.includes(origin)) {
        return callback(null, origin || '*');
      }
      return callback(new Error(`Origin ${origin} not allowed`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'api-key', 'x-qdrant-endpoint'],
    maxAge: 86400
  })
);

app.use(express.json({ limit: '10mb' }));

const ensureHttps = (value) => {
  if (!value) return '';
  let candidate = String(value).trim();
  if (!candidate) return '';
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:') {
      url.protocol = 'https:';
    }
    return url.toString().replace(/\/$/, '');
  } catch (error) {
    return candidate;
  }
};

const resolveAuthHeaders = (apiKey, authMode = 'auto') => {
  const headers = {};
  if (!apiKey) {
    return headers;
  }
  const normalized = String(apiKey).trim();
  if (!normalized) {
    return headers;
  }
  const mode = authMode === 'authorization' ? 'authorization' : authMode === 'api-key' ? 'api-key' : 'authorization';
  if (mode === 'authorization') {
    headers.Authorization = `Bearer ${normalized}`;
  } else {
    headers['api-key'] = normalized;
  }
  return headers;
};

const buildTargetUrl = (endpoint, path = '/') => {
  const base = ensureHttps(endpoint);
  if (!base) {
    throw new Error('Endpoint не указан.');
  }
  const safePath = typeof path === 'string' ? path.trim() : '';
  if (!safePath) {
    return `${base}/`;
  }
  if (safePath.startsWith('http://') || safePath.startsWith('https://')) {
    return safePath;
  }
  return `${base}${safePath.startsWith('/') ? '' : '/'}${safePath}`;
};

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/qdrant', async (req, res) => {
  try {
    const {
      endpoint,
      apiKey,
      path,
      method = 'GET',
      payload,
      authMode = 'auto',
      headers: extraHeaders = {}
    } = req.body || {};

    if (!endpoint) {
      return res.status(400).json({ error: 'Не указан endpoint Qdrant.' });
    }
    if (!apiKey) {
      return res.status(400).json({ error: 'Не указан API key Qdrant.' });
    }

    const targetUrl = buildTargetUrl(endpoint, path);
    const upperMethod = String(method || 'GET').toUpperCase();

    const headers = {
      Accept: 'application/json',
      ...resolveAuthHeaders(apiKey, authMode),
      ...(extraHeaders || {})
    };

    if (upperMethod !== 'GET' && upperMethod !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(targetUrl, {
      method: upperMethod,
      headers,
      body:
        upperMethod === 'GET' || upperMethod === 'HEAD'
          ? undefined
          : payload != null
          ? JSON.stringify(payload)
          : undefined
    });

    const responseText = await response.text();
    const contentType = response.headers.get('content-type') || 'application/json';

    res.status(response.status);
    res.setHeader('content-type', contentType);
    res.send(responseText);
  } catch (error) {
    console.error('[qdrant-proxy] request failed', error);
    res.status(500).json({ error: error?.message || 'Proxy error' });
  }
});

const port = Number(process.env.PORT || process.env.QDRANT_PROXY_PORT || 8787);
app.listen(port, () => {
  console.log(`Qdrant proxy listening on http://localhost:${port}`);
  if (!allowAll) {
    console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
  }
});

