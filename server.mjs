import express from 'express';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 4000;
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(__dirname, 'output');
const CONCURRENCY = Number(process.env.RENDER_CONCURRENCY || 1);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
// Token simple compartido con n8n para no dejar el endpoint abierto al público
const API_TOKEN = process.env.API_TOKEN || null;

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const ASSETS_DIR = path.join(OUTPUT_DIR, 'assets');
fs.mkdirSync(ASSETS_DIR, { recursive: true });

const EXTENSION_BY_MIMETYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
};

/** @type {Map<string, {id:string, status:string, outputFile?:string, error?:string, createdAt:number, inputProps:any}>} */
const jobs = new Map();
const queue = [];
let active = 0;
let serveUrlPromise = null;

function getServeUrl() {
  if (!serveUrlPromise) {
    serveUrlPromise = bundle({
      entryPoint: path.join(__dirname, 'src', 'index.jsx'),
    });
  }
  return serveUrlPromise;
}

async function processNext() {
  if (active >= CONCURRENCY) return;
  const id = queue.shift();
  if (!id) return;
  const job = jobs.get(id);
  if (!job) return;

  active += 1;
  job.status = 'rendering';

  try {
    const serveUrl = await getServeUrl();

    const composition = await selectComposition({
      serveUrl,
      id: 'CampaignVideo',
      inputProps: job.inputProps,
    });

    const outputFile = path.join(OUTPUT_DIR, `${id}.mp4`);

    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: outputFile,
      inputProps: job.inputProps,
    });

    job.status = 'done';
    job.outputFile = outputFile;
  } catch (err) {
    job.status = 'error';
    job.error = err?.message || String(err);
    console.error(`[render ${id}] error:`, err);
  } finally {
    active -= 1;
    processNext();
  }
}

function requireAuth(req, res, next) {
  if (!API_TOKEN) return next(); // sin token configurado = sin auth (solo para pruebas locales)
  const header = req.headers['authorization'] || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (token !== API_TOKEN) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

const app = express();
app.use(express.json({ limit: '25mb' }));
/**
 * POST /render
 * body: {
 *   imageUrl: string (requerido),
 *   audioUrl?: string,
 *   durationInSeconds: number (requerido),
 *   logoUrl?: string,
 *   captionText?: string,
 *   fadeOutSeconds?: number,
 *   width?: number, height?: number, fps?: number
 * }
 */
app.post('/render', requireAuth, (req, res) => {
  const {
    imageUrl,
    audioUrl,
    durationInSeconds,
    logoUrl,
    captionText,
    fadeOutSeconds,
    width,
    height,
    fps,
  } = req.body || {};

  if (!imageUrl) {
    return res.status(400).json({ error: 'imageUrl es requerido' });
  }
  if (!durationInSeconds) {
    return res.status(400).json({ error: 'durationInSeconds es requerido' });
  }

  const id = randomUUID();
  jobs.set(id, {
    id,
    status: 'queued',
    createdAt: Date.now(),
    inputProps: {
      imageUrl,
      audioUrl,
      durationInSeconds,
      logoUrl,
      captionText,
      fadeOutSeconds,
      width,
      height,
      fps,
    },
  });

  queue.push(id);
  processNext();

  res.status(202).json({ renderId: id, status: 'queued' });
});

/** GET /render/:id — estado del job (para hacer polling desde n8n) */
app.get('/render/:id', requireAuth, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'No encontrado' });

  if (job.status === 'done') {
    return res.json({
      status: job.status,
      videoUrl: `${PUBLIC_BASE_URL}/render/${job.id}/download`,
    });
  }
  if (job.status === 'error') {
    return res.json({ status: job.status, error: job.error });
  }
  res.json({ status: job.status });
});

/** GET /render/:id/download — sirve el MP4 ya renderizado */
app.get('/render/:id/download', requireAuth, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'done' || !job.outputFile) {
    return res.status(404).json({ error: 'No disponible' });
  }
  res.sendFile(job.outputFile);
});

/**
 * POST /assets
 * Sube un archivo en base64 (imagen o audio) y devuelve una URL pública
 * para usarlo luego como imageUrl/audioUrl en POST /render.
 * body: { data: "<base64 sin prefijo data:>", mimetype: "image/png" | "audio/mpeg" | ... }
 */
app.post('/assets', requireAuth, (req, res) => {
  const { data, mimetype } = req.body || {};

  if (!data) {
    return res.status(400).json({ error: 'data (base64) es requerido' });
  }
  const extension = EXTENSION_BY_MIMETYPE[mimetype];
  if (!extension) {
    return res.status(400).json({
      error: `mimetype no soportado: ${mimetype}`,
      soportados: Object.keys(EXTENSION_BY_MIMETYPE),
    });
  }

  try {
    const id = randomUUID();
    const fileName = `${id}.${extension}`;
    const filePath = path.join(ASSETS_DIR, fileName);
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));

    res.status(201).json({
      assetId: id,
      url: `${PUBLIC_BASE_URL}/assets/${fileName}`,
    });
  } catch (err) {
    res.status(500).json({ error: `No se pudo guardar el asset: ${err.message}` });
  }
});

/** GET /assets/:fileName — sirve un asset previamente subido */
app.get('/assets/:fileName', (req, res) => {
  const filePath = path.join(ASSETS_DIR, req.params.fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Asset no encontrado' });
  }
  res.sendFile(filePath);
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Remotion render service escuchando en puerto ${PORT}`);
  console.log(`Salida de videos en: ${OUTPUT_DIR}`);
  console.log(`Concurrencia de render: ${CONCURRENCY}`);
});
