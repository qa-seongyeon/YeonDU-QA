// YeonDU-QA server
// Plain Node http server (no framework deps) + Playwright (screenshot) + sharp (pixel diff)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');
const sharp = require('sharp');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const RESULTS_DIR = path.join(PUBLIC_DIR, 'results');
const MAX_BODY_BYTES = 20 * 1024 * 1024; // 20MB (base64 images)
const DIFF_THRESHOLD = 40; // per-pixel color distance threshold to count as "different"

fs.mkdirSync(RESULTS_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  // prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        if (buf.length === 0) return resolve({});
        resolve(JSON.parse(buf.toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function dataUrlToBuffer(dataUrl) {
  const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('INVALID_IMAGE');
  return Buffer.from(match[2], 'base64');
}

function parseFigmaUrl(figmaUrl) {
  const u = new URL(figmaUrl);
  const match = u.pathname.match(/\/(file|design|proto)\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error('INVALID_FIGMA_URL');
  const fileKey = match[2];
  const rawNodeId = u.searchParams.get('node-id');
  if (!rawNodeId) throw new Error('FIGMA_NODE_ID_MISSING');
  const nodeId = rawNodeId.includes('-') ? rawNodeId.replace('-', ':') : rawNodeId;
  return { fileKey, nodeId };
}

async function fetchFigmaImage(figmaUrl) {
  const token = process.env.FIGMA_TOKEN;
  if (!token) throw new Error('FIGMA_TOKEN_NOT_CONFIGURED');

  const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);
  const apiUrl = `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=2`;
  const apiRes = await fetch(apiUrl, { headers: { 'X-Figma-Token': token } });
  const apiData = await apiRes.json();
  if (!apiRes.ok || apiData.err) throw new Error(apiData.err || 'FIGMA_API_ERROR');

  const imageUrl = apiData.images && apiData.images[nodeId];
  if (!imageUrl) throw new Error('FIGMA_IMAGE_NOT_FOUND');

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error('FIGMA_IMAGE_DOWNLOAD_FAILED');
  return Buffer.from(await imgRes.arrayBuffer());
}

// Strip uniform-color padding (e.g. blank canvas around a manually captured
// reference screenshot) so it doesn't skew the pixel diff. No-op if there's
// no border to trim.
async function trimPadding(buffer) {
  try {
    return await sharp(buffer).trim().toBuffer();
  } catch {
    return buffer;
  }
}

function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function captureScreenshot(targetUrl, viewport) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(async () => {
      // fall back if networkidle never fires (e.g. long-poll/websocket pages)
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    });
    await page.waitForTimeout(500);
    const buffer = await page.screenshot({ fullPage: true, type: 'png' });
    return buffer;
  } finally {
    await browser.close();
  }
}

// Compare two PNG buffers pixel by pixel (resizes `actual` to match `reference` dims).
// Returns { diffBuffer (PNG), diffPercent, width, height }
async function diffImages(referenceBuffer, actualBuffer) {
  const refMeta = await sharp(referenceBuffer).metadata();
  const width = refMeta.width;
  const height = refMeta.height;

  const [refRaw, actRaw] = await Promise.all([
    sharp(referenceBuffer)
      .resize(width, height, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer(),
    sharp(actualBuffer)
      .resize(width, height, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer(),
  ]);

  const out = Buffer.alloc(width * height * 4);
  let diffCount = 0;
  const totalPixels = width * height;

  for (let i = 0; i < totalPixels; i++) {
    const o = i * 4;
    const r1 = refRaw[o], g1 = refRaw[o + 1], b1 = refRaw[o + 2];
    const r2 = actRaw[o], g2 = actRaw[o + 1], b2 = actRaw[o + 2];
    const dist = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);

    if (dist > DIFF_THRESHOLD) {
      diffCount++;
      out[o] = 255; // red highlight
      out[o + 1] = 0;
      out[o + 2] = 64;
      out[o + 3] = 255;
    } else {
      // dim the matching areas so diffs stand out
      out[o] = r2;
      out[o + 1] = g2;
      out[o + 2] = b2;
      out[o + 3] = 90;
    }
  }

  const diffBuffer = await sharp(out, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();

  const diffPercent = (diffCount / totalPixels) * 100;
  return { diffBuffer, diffPercent, width, height, diffCount, totalPixels };
}

async function handleCompare(req, res) {
  let body;
  try {
    body = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, e.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400, {
      error: e.message === 'PAYLOAD_TOO_LARGE' ? '이미지가 너무 큽니다 (20MB 이하).' : '요청 본문을 읽을 수 없습니다.',
    });
  }

  const { url, image, figmaUrl, viewportWidth, viewportHeight } = body || {};

  if (!isValidHttpUrl(url)) {
    return sendJSON(res, 400, { error: '올바른 URL을 입력해주세요 (http:// 또는 https://).' });
  }
  if (!image && !figmaUrl) {
    return sendJSON(res, 400, { error: '기준 스크린샷 또는 Figma 링크 중 하나를 입력해주세요.' });
  }

  let referenceBuffer;
  if (figmaUrl) {
    try {
      referenceBuffer = await fetchFigmaImage(figmaUrl);
    } catch (e) {
      return sendJSON(res, 502, { error: `Figma 이미지를 가져오지 못했습니다: ${e.message}` });
    }
  } else {
    try {
      referenceBuffer = dataUrlToBuffer(image);
    } catch {
      return sendJSON(res, 400, { error: '기준 스크린샷 이미지를 읽을 수 없습니다.' });
    }
  }
  referenceBuffer = await trimPadding(referenceBuffer);

  const viewport = {
    width: Number(viewportWidth) > 0 ? Math.min(Number(viewportWidth), 2560) : 1920,
    height: Number(viewportHeight) > 0 ? Math.min(Number(viewportHeight), 4000) : 1080,
  };

  const id = crypto.randomBytes(6).toString('hex');

  let actualBuffer;
  try {
    actualBuffer = await captureScreenshot(url, viewport);
  } catch (e) {
    return sendJSON(res, 502, { error: `해당 URL의 스크린샷을 캡처하지 못했습니다: ${e.message}` });
  }

  let diffResult;
  try {
    diffResult = await diffImages(referenceBuffer, actualBuffer);
  } catch (e) {
    return sendJSON(res, 500, { error: `이미지 비교 중 오류가 발생했습니다: ${e.message}` });
  }

  // Normalize captured/reference to same size as diff for clean side-by-side display
  const normalizedActual = await sharp(actualBuffer)
    .resize(diffResult.width, diffResult.height, { fit: 'fill' })
    .png()
    .toBuffer();
  const normalizedReference = await sharp(referenceBuffer)
    .resize(diffResult.width, diffResult.height, { fit: 'fill' })
    .png()
    .toBuffer();

  const refPath = `results/${id}-reference.png`;
  const actPath = `results/${id}-captured.png`;
  const diffPath = `results/${id}-diff.png`;

  await Promise.all([
    fs.promises.writeFile(path.join(PUBLIC_DIR, refPath), normalizedReference),
    fs.promises.writeFile(path.join(PUBLIC_DIR, actPath), normalizedActual),
    fs.promises.writeFile(path.join(PUBLIC_DIR, diffPath), diffResult.diffBuffer),
  ]);

  return sendJSON(res, 200, {
    referenceUrl: `/${refPath}`,
    capturedUrl: `/${actPath}`,
    diffUrl: `/${diffPath}`,
    diffPercent: Number(diffResult.diffPercent.toFixed(2)),
    diffPixels: diffResult.diffCount,
    totalPixels: diffResult.totalPixels,
    width: diffResult.width,
    height: diffResult.height,
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (req.method === 'POST' && pathname === '/api/compare') {
    return handleCompare(req, res);
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJSON(res, 200, { ok: true });
  }

  if (req.method === 'GET') {
    return serveStatic(req, res, pathname);
  }

  res.writeHead(405);
  res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log(`YeonDU-QA server running on http://localhost:${PORT}`);
});
