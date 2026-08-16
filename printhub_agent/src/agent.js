import WebSocket from 'ws';
import sharp from 'sharp';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_SERVER_URL = 'https://print.iceslam.ru';
const DEFAULT_WS_PATH = '/ws/agent';

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function deriveServerUrl(wsUrl) {
  const value = normalizeBaseUrl(wsUrl);
  if (!value) return '';
  try {
    const url = new URL(value);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = url.pathname.replace(/\/ws\/agent\/?$/, '') || '/';
    url.search = '';
    url.hash = '';
    return normalizeBaseUrl(url.toString());
  } catch {
    return '';
  }
}

function deriveWsUrl(serverUrl) {
  const value = normalizeBaseUrl(serverUrl);
  if (!value) return '';
  try {
    const url = new URL(value);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${DEFAULT_WS_PATH}`;
    url.search = '';
    url.hash = '';
    return normalizeBaseUrl(url.toString());
  } catch {
    return '';
  }
}

const configuredServerUrl = normalizeBaseUrl(process.env.SERVER_URL);
const configuredWsUrl = normalizeBaseUrl(process.env.WS_URL);

const SERVER_URL = (
  configuredServerUrl
  || deriveServerUrl(configuredWsUrl)
  || DEFAULT_SERVER_URL
);

const WS_URL = (
  configuredWsUrl
  || deriveWsUrl(configuredServerUrl || SERVER_URL)
  || 'wss://print.iceslam.ru/ws/agent'
);

const AGENT_TOKEN = requiredEnv(
  'AGENT_TOKEN',
  'Укажите AGENT_TOKEN в .env.agent — он должен совпадать с AGENT_TOKEN на сервере.'
);

const AGENT_ID = process.env.AGENT_ID || 'iceslamprint-xp365b';
const PRINTER_HOST = process.env.PRINTER_HOST || '';
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);
const PRINTER_NAME = process.env.PRINTER_NAME || 'Xprinter XP-365B';
const PRINT_DPI = Number(process.env.PRINT_DPI || 203);
const WS_STATUS_INTERVAL_MS = Number(process.env.WS_STATUS_INTERVAL_MS || process.env.WS_PING_MS || 10000);
const WS_NATIVE_PING_MS = Number(process.env.WS_NATIVE_PING_MS || 10000);
const WS_PONG_TIMEOUT_MS = Number(process.env.WS_PONG_TIMEOUT_MS || 45000);

const PDF_PRINT_MODE = (process.env.PDF_PRINT_MODE || 'cups').toLowerCase();
const CUPS_PRINTER = process.env.CUPS_PRINTER || 'XP365B';
const CUPS_PRINTER_USB = process.env.CUPS_PRINTER_USB || CUPS_PRINTER;
const CUPS_PRINTER_IP = process.env.CUPS_PRINTER_IP || '';
const PRINTER_CONNECTION_MODE = (process.env.PRINTER_CONNECTION_MODE || 'auto').toLowerCase(); // auto | usb | ip | cups
let lastPrintTransport = null;
const CUPS_SERVER = process.env.CUPS_SERVER || '';
const PDFINFO_BIN = process.env.PDFINFO_BIN || 'pdfinfo';
const PDF_DETECT_TOLERANCE_MM = Number(process.env.PDF_DETECT_TOLERANCE_MM || 3);
const CUPS_READY_TIMEOUT_MS = Number(process.env.CUPS_READY_TIMEOUT_MS || 20000);
const CUPS_HEALTH_INTERVAL_MS = Number(process.env.CUPS_HEALTH_INTERVAL_MS || 15000);
const CUPS_PRINT_RETRIES = Math.max(1, Number(process.env.CUPS_PRINT_RETRIES || 2));
const CUPS_PRINT_RETRY_DELAY_MS = Number(process.env.CUPS_PRINT_RETRY_DELAY_MS || 1500);
const CUPS_WAIT_FOR_JOB = !['0','false','no','off'].includes(String(process.env.CUPS_WAIT_FOR_JOB || 'true').toLowerCase());
const CUPS_JOB_TIMEOUT_MS = Number(process.env.CUPS_JOB_TIMEOUT_MS || 120000);
const CUPS_JOB_POLL_MS = Number(process.env.CUPS_JOB_POLL_MS || 1000);
let lastCupsHealth = {
  schedulerRunning: false,
  socketPresent: false,
  usbQueueExists: false,
  ipQueueExists: false,
  updatedAt: null,
  detail: 'not checked yet',
};

let activeWs = null;
let reconnectTimer = null;
let jobQueueRunning = false;
let activeJobId = null;
const jobQueue = [];
const queuedJobIds = new Set();
const finishedJobIds = new Set();
const terminalOutbox = [];


// Имена PageSize должны совпадать с новым PPD из архива.
const CUPS_PAGE_SIZES = {
  '58x40': process.env.CUPS_PAGE_SIZE_58X40 || process.env.CUPS_MEDIA_58X40 || 'w5.8h4',
  '40x58': process.env.CUPS_PAGE_SIZE_40X58 || process.env.CUPS_MEDIA_40X58 || 'w4h5.8',
  '75x120': process.env.CUPS_PAGE_SIZE_75X120 || process.env.CUPS_MEDIA_75X120 || 'w7.5h12',
  '120x75': process.env.CUPS_PAGE_SIZE_120X75 || process.env.CUPS_MEDIA_120X75 || 'w12h7.5',
};

const PRESETS = {
  '58x40': {
    widthMm: 58,
    heightMm: 40,
    widthPx: 464,
    heightPx: 320,
    cupsPageSize: CUPS_PAGE_SIZES['58x40'],
  },
  '40x58': {
    widthMm: 40,
    heightMm: 58,
    widthPx: 320,
    heightPx: 464,
    cupsPageSize: CUPS_PAGE_SIZES['40x58'],
  },
  '75x120': {
    widthMm: 75,
    heightMm: 120,
    widthPx: 600,
    heightPx: 960,
    cupsPageSize: CUPS_PAGE_SIZES['75x120'],
  },
  '120x75': {
    widthMm: 120,
    heightMm: 75,
    widthPx: 960,
    heightPx: 600,
    cupsPageSize: CUPS_PAGE_SIZES['120x75'],
  },
};

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

log('agent configuration', {
  serverUrl: SERVER_URL,
  wsUrl: WS_URL,
  agentId: AGENT_ID,
  printerMode: PRINTER_CONNECTION_MODE,
  cupsServer: CUPS_SERVER || '(default)',
  cupsUsbQueue: CUPS_PRINTER_USB || '(not configured)',
  cupsIpQueue: CUPS_PRINTER_IP || '(not configured)',
});

function requiredEnv(name, hint = '') {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    const suffix = hint ? ` ${hint}` : '';
    throw new Error(`Missing required env ${name}.${suffix}`);
  }
  return value;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mmToDots(mm) {
  return Math.round((mm / 25.4) * PRINT_DPI);
}

function ptsToMm(points) {
  return (points / 72) * 25.4;
}

function close(a, b, tolerance = PDF_DETECT_TOLERANCE_MM) {
  return Math.abs(a - b) <= tolerance;
}

function normalizeSizeKey(value) {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace('×', 'x')
    .replace('*', 'x')
    .replace('мм', '')
    .replace('mm', '');
}

function normalizeFileUrl(fileUrl) {
  if (!fileUrl) throw new Error('Job has no fileUrl/downloadUrl/url');
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  return `${SERVER_URL}${fileUrl.startsWith('/') ? '' : '/'}${fileUrl}`;
}

async function download(fileUrl) {
  const url = normalizeFileUrl(fileUrl);
  const res = await fetch(url, {
    headers: AGENT_TOKEN ? { Authorization: `Bearer ${AGENT_TOKEN}` } : undefined,
  });
  if (!res.ok) throw new Error(`Download failed ${res.status} ${res.statusText}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function isPdfJob(job, buffer) {
  const filename = String(job.filename || job.fileName || job.originalName || '').toLowerCase();
  const mimeType = String(job.mimeType || job.contentType || '').toLowerCase();
  return filename.endsWith('.pdf') || mimeType.includes('pdf') || buffer.subarray(0, 4).toString() === '%PDF';
}

function presetByExactSize(widthMm, heightMm) {
  if (close(widthMm, 58) && close(heightMm, 40)) return { name: '58x40', ...PRESETS['58x40'], detectedWidthMm: widthMm, detectedHeightMm: heightMm };
  if (close(widthMm, 40) && close(heightMm, 58)) return { name: '40x58', ...PRESETS['40x58'], detectedWidthMm: widthMm, detectedHeightMm: heightMm };
  if (close(widthMm, 75) && close(heightMm, 120)) return { name: '75x120', ...PRESETS['75x120'], detectedWidthMm: widthMm, detectedHeightMm: heightMm };
  if (close(widthMm, 120) && close(heightMm, 75)) return { name: '120x75', ...PRESETS['120x75'], detectedWidthMm: widthMm, detectedHeightMm: heightMm };
  return null;
}

function presetByRatio(widthMm, heightMm) {
  const ratio = Math.max(widthMm, heightMm) / Math.min(widthMm, heightMm);

  // 58/40 = 1.45
  if (ratio >= 1.35 && ratio <= 1.55) {
    return widthMm >= heightMm
      ? { name: '58x40', ...PRESETS['58x40'], detectedWidthMm: widthMm, detectedHeightMm: heightMm }
      : { name: '40x58', ...PRESETS['40x58'], detectedWidthMm: widthMm, detectedHeightMm: heightMm };
  }

  // 120/75 = 1.60
  if (ratio >= 1.52 && ratio <= 1.72) {
    return widthMm >= heightMm
      ? { name: '120x75', ...PRESETS['120x75'], detectedWidthMm: widthMm, detectedHeightMm: heightMm }
      : { name: '75x120', ...PRESETS['75x120'], detectedWidthMm: widthMm, detectedHeightMm: heightMm };
  }

  return null;
}

function resolvePreset(job) {
  const rawPreset = job.preset || job.labelPreset || job.labelSize || job.size;
  const preset = normalizeSizeKey(rawPreset);
  if (PRESETS[preset]) return { name: preset, ...PRESETS[preset] };

  const widthMm = Number(job.widthMm || job.labelWidthMm);
  const heightMm = Number(job.heightMm || job.labelHeightMm);
  if (widthMm > 0 && heightMm > 0) {
    const exact = presetByExactSize(widthMm, heightMm);
    if (exact) return exact;
    const ratio = presetByRatio(widthMm, heightMm);
    if (ratio) return ratio;
  }

  return null;
}

function parsePdfInfoPageSize(output) {
  // pdfinfo examples:
  // Page size:       164.41 x 113.39 pts
  // CropBox:             0.00     0.00   164.41   113.39
  const cropMatch = output.match(/CropBox:\s*([-.\d]+)\s+([-.\d]+)\s+([-.\d]+)\s+([-.\d]+)/i);
  if (cropMatch) {
    const x1 = Number(cropMatch[1]);
    const y1 = Number(cropMatch[2]);
    const x2 = Number(cropMatch[3]);
    const y2 = Number(cropMatch[4]);
    const widthPt = Math.abs(x2 - x1);
    const heightPt = Math.abs(y2 - y1);
    if (widthPt > 0 && heightPt > 0) {
      return { source: 'CropBox', widthPt, heightPt, widthMm: ptsToMm(widthPt), heightMm: ptsToMm(heightPt) };
    }
  }

  const pageSizeMatch = output.match(/Page size:\s*([-.\d]+)\s+x\s+([-.\d]+)\s+pts/i);
  if (pageSizeMatch) {
    const widthPt = Number(pageSizeMatch[1]);
    const heightPt = Number(pageSizeMatch[2]);
    if (widthPt > 0 && heightPt > 0) {
      return { source: 'Page size', widthPt, heightPt, widthMm: ptsToMm(widthPt), heightMm: ptsToMm(heightPt) };
    }
  }

  return null;
}

async function detectPdfPreset(buffer, job = {}) {
  const forced = resolvePreset(job);
  if (forced) return { ...forced, confidence: 'forced' };

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'printhub-pdfinfo-'));
  const pdfPath = path.join(dir, 'label.pdf');

  try {
    await fs.writeFile(pdfPath, buffer);

    const { stdout } = await execFileAsync(PDFINFO_BIN, ['-box', '-f', '1', '-l', '1', pdfPath], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });

    const detected = parsePdfInfoPageSize(stdout);
    if (!detected) {
      throw new Error('Cannot read PDF page size via pdfinfo');
    }

    const exact = presetByExactSize(detected.widthMm, detected.heightMm);
    if (exact) {
      return {
        ...exact,
        confidence: 'exact',
        pdfBox: detected.source,
        detectedWidthMm: Number(detected.widthMm.toFixed(2)),
        detectedHeightMm: Number(detected.heightMm.toFixed(2)),
      };
    }

    const ratio = presetByRatio(detected.widthMm, detected.heightMm);
    if (ratio) {
      return {
        ...ratio,
        confidence: 'ratio',
        pdfBox: detected.source,
        detectedWidthMm: Number(detected.widthMm.toFixed(2)),
        detectedHeightMm: Number(detected.heightMm.toFixed(2)),
      };
    }

    throw new Error(
      `Cannot confidently detect label size from PDF ${detected.source}: ${detected.widthMm.toFixed(2)}x${detected.heightMm.toFixed(2)} mm. ` +
      'Supported sizes: 58x40, 40x58, 75x120, 120x75.'
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function pdfToPng(buffer) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'printhub-label-'));
  const pdfPath = path.join(dir, 'input.pdf');
  const outPrefix = path.join(dir, 'page');

  try {
    await fs.writeFile(pdfPath, buffer);
    await execFileAsync('pdftoppm', [
      '-png',
      '-singlefile',
      '-cropbox',
      '-r',
      String(PRINT_DPI),
      pdfPath,
      outPrefix,
    ]);
    return await fs.readFile(`${outPrefix}.png`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function shouldRotate(job, metadata, preset) {
  if (job.rotate === true || job.rotate === 90 || job.rotation === 90) return true;
  if (job.rotate === false || job.rotation === 0) return false;

  const inputLandscape = metadata.width >= metadata.height;
  const targetLandscape = preset.widthMm >= preset.heightMm;
  return inputLandscape !== targetLandscape;
}

async function detectImagePreset(buffer, job = {}) {
  const forced = resolvePreset(job);
  if (forced) return forced;

  const metadata = await sharp(buffer, { limitInputPixels: false }).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Cannot read image dimensions');
  }

  const ratio = Math.max(metadata.width, metadata.height) / Math.min(metadata.width, metadata.height);

  if (ratio >= 1.35 && ratio <= 1.55) {
    return metadata.width >= metadata.height
      ? { name: '58x40', ...PRESETS['58x40'] }
      : { name: '40x58', ...PRESETS['40x58'] };
  }

  if (ratio >= 1.52 && ratio <= 1.72) {
    return metadata.width >= metadata.height
      ? { name: '120x75', ...PRESETS['120x75'] }
      : { name: '75x120', ...PRESETS['75x120'] };
  }

  throw new Error(`Cannot confidently detect image label size: ${metadata.width}x${metadata.height}px. Supported sizes: 58x40, 40x58, 75x120, 120x75.`);
}

async function imageToTspl(buffer, job, presetOverride = null) {
  const preset = presetOverride || await detectImagePreset(buffer, job);
  const targetWidth = mmToDots(preset.widthMm);
  const targetHeight = mmToDots(preset.heightMm);

  let image = sharp(buffer, { limitInputPixels: false });
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('Cannot read image dimensions after PDF/image conversion');
  }

  if (shouldRotate(job, metadata, preset)) {
    image = image.rotate(90);
  }

  // Trim помогает с этикетками, которые экспортируются с небольшими белыми полями.
  // Если trim не сработает, sharp вернет исходную картинку.
  image = image
    .flatten({ background: 'white' })
    .trim({ background: 'white', threshold: 8 });

  const raw = await image
    .resize(targetWidth, targetHeight, {
      fit: 'contain',
      background: 'white',
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
    })
    .flatten({ background: 'white' })
    .grayscale()
    .threshold(180)
    .raw()
    .toBuffer();

  const bytesPerRow = Math.ceil(targetWidth / 8);
  const bitmap = Buffer.alloc(bytesPerRow * targetHeight, 0xff);

  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const pixel = raw[y * targetWidth + x];
      if (pixel < 128) {
        const idx = y * bytesPerRow + Math.floor(x / 8);
        bitmap[idx] &= ~(0x80 >> (x % 8));
      }
    }
  }

  const copies = Math.max(1, Number(job.copies || 1));
  const header = [
    `SIZE ${preset.widthMm} mm,${preset.heightMm} mm`,
    'GAP 3 mm,0 mm',
    'DENSITY 15',
    'SPEED 12',
    'DIRECTION 1',
    'REFERENCE 0,0',
    'OFFSET 0 mm',
    'SET PEEL OFF',
    'SET CUTTER OFF',
    'CLS',
    `BITMAP 0,0,${bytesPerRow},${targetHeight},0,`,
  ].join('\r\n');
  const footer = `\r\nPRINT ${copies}\r\n`;

  return Buffer.concat([Buffer.from(header, 'ascii'), bitmap, Buffer.from(footer, 'ascii')]);
}

function cupsEnv() {
  if (!CUPS_SERVER) return process.env;
  return { ...process.env, CUPS_SERVER };
}

async function cupsSocketPresent() {
  if (!CUPS_SERVER || !CUPS_SERVER.startsWith('/')) return true;
  try {
    const stat = await fs.stat(CUPS_SERVER);
    return stat.isSocket();
  } catch {
    return false;
  }
}

async function cupsSchedulerState() {
  const socketPresent = await cupsSocketPresent();
  try {
    const { stdout = '', stderr = '' } = await execFileAsync('lpstat', ['-r'], {
      env: cupsEnv(),
      timeout: 8000,
      maxBuffer: 256 * 1024,
    });
    const detail = String(stdout || stderr).trim();
    return {
      running: /scheduler is running/i.test(detail),
      socketPresent,
      detail: detail || 'lpstat returned no scheduler status',
    };
  } catch (error) {
    return {
      running: false,
      socketPresent,
      detail: String(error?.stderr || error?.message || error).trim(),
    };
  }
}

async function cupsQueueState(queue) {
  if (!queue) {
    return { exists: false, queue: '', details: '', error: 'queue name is empty' };
  }
  try {
    const { stdout = '', stderr = '' } = await execFileAsync('lpstat', ['-p', queue], {
      env: cupsEnv(),
      timeout: 8000,
      maxBuffer: 256 * 1024,
    });
    return {
      exists: true,
      queue,
      details: String(stdout || stderr).trim(),
      error: '',
    };
  } catch (error) {
    return {
      exists: false,
      queue,
      details: '',
      error: String(error?.stderr || error?.message || error).trim(),
    };
  }
}

async function refreshCupsHealth({ logChanges = false } = {}) {
  const previous = lastCupsHealth;
  const scheduler = await cupsSchedulerState();
  let usbQueueExists = false;
  let ipQueueExists = false;

  if (scheduler.running) {
    if (CUPS_PRINTER_USB) usbQueueExists = (await cupsQueueState(CUPS_PRINTER_USB)).exists;
    if (CUPS_PRINTER_IP) ipQueueExists = (await cupsQueueState(CUPS_PRINTER_IP)).exists;
  }

  lastCupsHealth = {
    schedulerRunning: scheduler.running,
    socketPresent: scheduler.socketPresent,
    usbQueueExists,
    ipQueueExists,
    updatedAt: new Date().toISOString(),
    detail: scheduler.detail,
  };

  if (logChanges && (
    previous.schedulerRunning !== lastCupsHealth.schedulerRunning ||
    previous.socketPresent !== lastCupsHealth.socketPresent ||
    previous.usbQueueExists !== lastCupsHealth.usbQueueExists ||
    previous.ipQueueExists !== lastCupsHealth.ipQueueExists
  )) {
    log('CUPS health changed', lastCupsHealth);
  }

  return lastCupsHealth;
}

async function waitForCupsScheduler(timeoutMs = CUPS_READY_TIMEOUT_MS) {
  const deadline = Date.now() + Math.max(1000, timeoutMs);
  let state = await refreshCupsHealth();

  while (!state.schedulerRunning && Date.now() < deadline) {
    log('CUPS scheduler unavailable inside agent; waiting', {
      cupsServer: CUPS_SERVER || '(default)',
      socketPresent: state.socketPresent,
      detail: state.detail,
    });
    await sleep(1000);
    state = await refreshCupsHealth();
  }

  if (!state.schedulerRunning) {
    throw new Error(
      'CUPS scheduler недоступен внутри контейнера агента. ' +
      `CUPS_SERVER=${CUPS_SERVER || '(default)'}; socket=${state.socketPresent ? 'present' : 'missing'}; ` +
      `lpstat=${state.detail || 'unknown'}. ` +
      PRINTER_CONNECTION_MODE === 'cups'
        ? 'Проверьте, что CUPS App запущен, порт 631 доступен и CUPS_SERVER указан правильно.'
        : 'Проверьте bind mount /run/cups:/run/cups и состояние host CUPS.'
    );
  }

  return state;
}

function isRecoverableCupsError(message) {
  return /scheduler is not running|printer or class does not exist|unknown destination|connection refused|broken pipe|transport endpoint/i.test(String(message || ''));
}

function formatCupsFailure(item) {
  if (item.type === 'missing') {
    return `${item.transport} "${item.queue}": очередь CUPS не существует`;
  }
  return `${item.transport} "${item.queue}": ${item.error}`;
}

function parseLpRequestId(output) {
  const text = String(output || '');
  const match = text.match(/request id is\s+([^\s]+)/i);
  return match ? match[1] : '';
}

async function waitForCupsJob(queue, requestId) {
  if (!CUPS_WAIT_FOR_JOB || !requestId) return;

  const deadline = Date.now() + Math.max(5000, CUPS_JOB_TIMEOUT_MS);
  while (Date.now() < deadline) {
    const scheduler = await cupsSchedulerState();
    if (!scheduler.running) {
      await sleep(Math.min(1500, CUPS_JOB_POLL_MS));
      continue;
    }

    try {
      const { stdout = '' } = await execFileAsync('lpstat', ['-W', 'not-completed', '-o', queue], {
        env: cupsEnv(),
        timeout: 8000,
        maxBuffer: 512 * 1024,
      });

      const pending = String(stdout).split(/\r?\n/).some(line => line.includes(requestId));
      if (!pending) {
        log('CUPS job left pending queue', { queue, requestId });
        return;
      }
    } catch (error) {
      const message = String(error?.stderr || error?.message || error).trim();
      // lpstat may return non-zero for an empty queue. That means the job is no longer pending.
      if (!/scheduler is not running|connection refused|broken pipe/i.test(message)) {
        log('CUPS pending queue empty or unavailable after accepted job', { queue, requestId, detail: message });
        return;
      }
    }

    await sleep(Math.max(250, CUPS_JOB_POLL_MS));
  }

  throw new Error(`CUPS job ${requestId} не завершился за ${Math.round(CUPS_JOB_TIMEOUT_MS / 1000)} сек.`);
}

function cupsPrinterCandidates() {
  if (PRINTER_CONNECTION_MODE === 'cups') {
    return [{
      queue: CUPS_PRINTER || CUPS_PRINTER_USB,
      transport: 'Home Assistant CUPS / IPP',
    }].filter(x => x.queue);
  }

  if (PRINTER_CONNECTION_MODE === 'usb') {
    return [{ queue: CUPS_PRINTER_USB, transport: 'USB / CUPS' }].filter(x => x.queue);
  }

  if (PRINTER_CONNECTION_MODE === 'ip') {
    return [{ queue: CUPS_PRINTER_IP || CUPS_PRINTER, transport: 'IP / CUPS' }].filter(x => x.queue);
  }

  const result = [];
  if (CUPS_PRINTER_USB) result.push({ queue: CUPS_PRINTER_USB, transport: 'USB / CUPS' });
  if (CUPS_PRINTER_IP && CUPS_PRINTER_IP !== CUPS_PRINTER_USB) {
    result.push({ queue: CUPS_PRINTER_IP, transport: 'IP / CUPS' });
  }
  return result;
}

async function printPdfViaCups(buffer, job) {
  const preset = await detectPdfPreset(buffer, job);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'printhub-cups-'));
  const filename = String(job.filename || job.fileName || 'label.pdf').replace(/[^\wа-яА-ЯёЁ.\- ]+/g, '_');
  const filePath = path.join(dir, filename.toLowerCase().endsWith('.pdf') ? filename : 'label.pdf');

  try {
    await fs.writeFile(filePath, buffer);
    await waitForCupsScheduler();

    const copies = Math.max(1, Number(job.copies || 1));
    const candidates = cupsPrinterCandidates();
    if (!candidates.length) {
      throw new Error('No CUPS printer queue configured for selected connection mode');
    }

    const failures = [];

    for (const candidate of candidates) {
      await waitForCupsScheduler();
      let state = await cupsQueueState(candidate.queue);

      if (!state.exists) {
        // CUPS мог перезапуститься прямо перед проверкой. Один короткий цикл восстановления.
        await sleep(CUPS_PRINT_RETRY_DELAY_MS);
        await waitForCupsScheduler();
        state = await cupsQueueState(candidate.queue);
      }

      if (!state.exists) {
        failures.push({
          type: 'missing',
          queue: candidate.queue,
          transport: candidate.transport,
          error: state.error,
        });

        log('CUPS queue unavailable; skipping', {
          printer: candidate.queue,
          transport: candidate.transport,
          mode: PRINTER_CONNECTION_MODE,
          reason: state.error || 'queue not found',
        });

        if (PRINTER_CONNECTION_MODE !== 'auto') {
          throw new Error(
            `${candidate.transport} "${candidate.queue}": очередь CUPS не существует. ` +
            `Проверьте host: lpstat -p ${candidate.queue}; container: lpstat -p ${candidate.queue}`
          );
        }
        continue;
      }

      const args = [
        '-d', candidate.queue,
        '-n', String(copies),
        '-t', `PrintHub ${preset.name}`,
        '-o', `PageSize=${preset.cupsPageSize}`,
        '-o', `media=${preset.cupsPageSize}`,
        '-o', 'Resolution=203dpi',
        '-o', 'MediaMethod=Direct',
        '-o', 'PaperType=LabelGaps',
        '-o', 'GapsHeight=3',
        '-o', 'PrintSpeed=12',
        '-o', 'Darkness=15',
        '-o', 'HalftoneType=None',
        '-o', 'fit-to-page',
        '-o', 'print-scaling=fit',
        '-o', 'page-left=0',
        '-o', 'page-right=0',
        '-o', 'page-top=0',
        '-o', 'page-bottom=0',
        filePath,
      ];

      for (let attempt = 1; attempt <= CUPS_PRINT_RETRIES; attempt++) {
        log('printing PDF via CUPS', {
          printer: candidate.queue,
          transport: candidate.transport,
          attempt,
          preset: preset.name,
          pageSize: preset.cupsPageSize,
          confidence: preset.confidence,
          pdfBox: preset.pdfBox,
          detected: preset.detectedWidthMm && preset.detectedHeightMm
            ? `${preset.detectedWidthMm}x${preset.detectedHeightMm}mm`
            : undefined,
        });

        try {
          await waitForCupsScheduler();
          const queueState = await cupsQueueState(candidate.queue);
          if (!queueState.exists) {
            throw new Error(`CUPS queue ${candidate.queue} disappeared before lp`);
          }

          const { stdout = '', stderr = '' } = await execFileAsync('lp', args, {
            env: cupsEnv(),
            timeout: 30000,
            maxBuffer: 1024 * 1024,
          });

          const response = String(stdout || stderr).trim();
          const requestId = parseLpRequestId(response);
          lastPrintTransport = `${candidate.transport}: ${candidate.queue}`;

          log('CUPS print accepted', {
            printer: candidate.queue,
            transport: candidate.transport,
            requestId: requestId || undefined,
            response: response || undefined,
          });

          await waitForCupsJob(candidate.queue, requestId);
          await refreshCupsHealth();
          return;
        } catch (error) {
          const message = String(error?.stderr || error?.message || error).trim();
          log('CUPS print attempt failed', {
            printer: candidate.queue,
            transport: candidate.transport,
            mode: PRINTER_CONNECTION_MODE,
            attempt,
            error: message,
          });

          if (attempt < CUPS_PRINT_RETRIES && isRecoverableCupsError(message)) {
            log('recoverable CUPS error; waiting for scheduler and retrying', {
              printer: candidate.queue,
              delayMs: CUPS_PRINT_RETRY_DELAY_MS,
            });
            await sleep(CUPS_PRINT_RETRY_DELAY_MS);
            await waitForCupsScheduler();
            continue;
          }

          failures.push({
            type: 'print',
            queue: candidate.queue,
            transport: candidate.transport,
            error: message,
          });
          break;
        }
      }

      if (PRINTER_CONNECTION_MODE !== 'auto') {
        throw new Error(failures.map(formatCupsFailure).join(' | '));
      }
    }

    throw new Error(
      'Все доступные способы CUPS-печати завершились ошибкой. ' +
      failures.map(formatCupsFailure).join(' | ')
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function jobToRaw(job) {
  const fileUrl = job.fileUrl || job.downloadUrl || job.url;
  let input = await download(fileUrl);

  if (isPdfJob(job, input)) {
    if (PDF_PRINT_MODE === 'cups') {
      await printPdfViaCups(input, job);
      return null;
    }

    const preset = await detectPdfPreset(input, job);
    input = await pdfToPng(input);
    return imageToTspl(input, job, preset);
  }

  return imageToTspl(input, job);
}

function sendToPrinter(raw) {
  if (!PRINTER_HOST) throw new Error('PRINTER_HOST is not configured for direct IP printing');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: PRINTER_HOST, port: PRINTER_PORT }, () => {
      socket.write(raw, () => socket.end());
    });

    socket.setTimeout(30000);
    socket.on('timeout', () => {
      socket.destroy(new Error('Printer TCP timeout'));
    });
    socket.on('error', reject);
    socket.on('close', hadError => {
      if (!hadError) resolve();
    });
  });
}

function statusPayload(type = 'agent:status') {
  return {
    type,
    agentId: AGENT_ID,
    printerName: PRINTER_NAME,
    printerHost: PRINTER_HOST || null,
    printerPort: PRINTER_PORT,
    connectionMode: PRINTER_CONNECTION_MODE,
    cupsServer: CUPS_SERVER || null,
    cupsPrinterUsb: CUPS_PRINTER_USB || null,
    cupsPrinterIp: CUPS_PRINTER_IP || null,
    cupsSchedulerRunning: lastCupsHealth.schedulerRunning,
    cupsSocketPresent: lastCupsHealth.socketPresent,
    cupsQueueUsbExists: lastCupsHealth.usbQueueExists,
    cupsQueueIpExists: lastCupsHealth.ipQueueExists,
    cupsHealthDetail: lastCupsHealth.detail || null,
    cupsHealthUpdatedAt: lastCupsHealth.updatedAt || null,
    lastPrintTransport,
    pdfPrintMode: PDF_PRINT_MODE,
    busy: Boolean(activeJobId),
    activeJobId: activeJobId || null,
    queuedJobs: jobQueue.length,
    version: '1.4.0',
  };
}

function sendOn(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function sendCurrent(payload, { buffer = false } = {}) {
  if (sendOn(activeWs, payload)) return true;

  if (buffer) {
    terminalOutbox.push(payload);
    while (terminalOutbox.length > 100) terminalOutbox.shift();
  }
  return false;
}

function flushTerminalOutbox() {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;
  while (terminalOutbox.length) {
    const payload = terminalOutbox[0];
    if (!sendOn(activeWs, payload)) return;
    terminalOutbox.shift();
  }
}

function rememberFinished(jobId) {
  if (!jobId) return;
  finishedJobIds.add(jobId);
  if (finishedJobIds.size > 200) {
    const first = finishedJobIds.values().next().value;
    if (first) finishedJobIds.delete(first);
  }
}

async function handleJob(job) {
  const jobId = job.id || job.jobId;
  try {
    log('job received', jobId, job.filename || job.fileName || 'file');
    const raw = await jobToRaw(job);
    if (raw) {
      await sendToPrinter(raw);
    }

    log('job printed', jobId, lastPrintTransport || CUPS_PRINTER_USB || PRINTER_NAME);
    sendCurrent({ type: 'job:done', jobId, agentId: AGENT_ID }, { buffer: true });
  } catch (error) {
    log('job failed', jobId, error);
    sendCurrent({
      type: 'job:failed',
      jobId,
      agentId: AGENT_ID,
      error: error?.message || String(error),
    }, { buffer: true });
  } finally {
    rememberFinished(jobId);
    sendCurrent(statusPayload());
  }
}

function enqueueJob(job) {
  const jobId = job?.id || job?.jobId;
  if (!jobId) return;

  if (finishedJobIds.has(jobId) || queuedJobIds.has(jobId) || activeJobId === jobId) {
    log('duplicate job ignored', jobId);
    return;
  }

  queuedJobIds.add(jobId);
  jobQueue.push(job);
  log('job queued', { jobId, queueLength: jobQueue.length });

  processJobQueue().catch(error => {
    log('job queue processing error', error?.message || error);
  });
}

async function processJobQueue() {
  if (jobQueueRunning) return;
  jobQueueRunning = true;

  try {
    while (jobQueue.length) {
      const job = jobQueue.shift();
      const jobId = job?.id || job?.jobId;
      queuedJobIds.delete(jobId);
      activeJobId = jobId;

      // Сервер и Mini App сразу видят, что агент занят печатью.
      sendCurrent({
        type: 'job-status',
        jobId,
        agentId: AGENT_ID,
        status: 'printing',
      }, { buffer: true });
      sendCurrent(statusPayload());

      // ВАЖНО: задания выполняются строго по одному. Раньше несколько входящих
      // job могли одновременно запускать lp/pdfinfo/lpstat и перегружать Orange Pi/CUPS.
      await handleJob(job);

      activeJobId = null;
      sendCurrent(statusPayload());
    }
  } finally {
    activeJobId = null;
    jobQueueRunning = false;
    sendCurrent(statusPayload());
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3000);
}

function connect() {
  const separator = WS_URL.includes('?') ? '&' : '?';
  const url = `${WS_URL}${separator}agentId=${encodeURIComponent(AGENT_ID)}&token=${encodeURIComponent(AGENT_TOKEN)}`;
  log('connecting', url.replace(AGENT_TOKEN, '***'));

  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${AGENT_TOKEN}`,
    },
    handshakeTimeout: 15000,
  });

  let statusTimer = null;
  let nativePingTimer = null;
  let lastPongAt = Date.now();

  const clearSocketTimers = () => {
    if (statusTimer) clearInterval(statusTimer);
    if (nativePingTimer) clearInterval(nativePingTimer);
    statusTimer = null;
    nativePingTimer = null;
  };

  ws.on('open', () => {
    activeWs = ws;
    lastPongAt = Date.now();

    log('connected');
    sendOn(ws, statusPayload('agent:hello'));
    sendOn(ws, statusPayload());
    flushTerminalOutbox();

    // JSON status heartbeat работает независимо от выполнения print job.
    statusTimer = setInterval(() => {
      if (ws !== activeWs || ws.readyState !== WebSocket.OPEN) return;
      sendOn(ws, statusPayload());
      sendOn(ws, { type: 'agent:ping', agentId: AGENT_ID, busy: Boolean(activeJobId) });
    }, Math.max(5000, WS_STATUS_INTERVAL_MS));
    statusTimer.unref?.();

    // Дополнительный RFC6455 ping: не полагаемся только на server heartbeat/Nginx.
    nativePingTimer = setInterval(() => {
      if (ws !== activeWs || ws.readyState !== WebSocket.OPEN) return;

      if (Date.now() - lastPongAt > Math.max(20000, WS_PONG_TIMEOUT_MS)) {
        log('websocket pong timeout; reconnecting', {
          lastPongMsAgo: Date.now() - lastPongAt,
          busy: Boolean(activeJobId),
          activeJobId,
        });
        ws.terminate();
        return;
      }

      try {
        ws.ping();
      } catch (error) {
        log('websocket native ping failed', error?.message || error);
        ws.terminate();
      }
    }, Math.max(5000, WS_NATIVE_PING_MS));
    nativePingTimer.unref?.();
  });

  ws.on('pong', () => {
    lastPongAt = Date.now();
  });

  ws.on('message', data => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (message.type === 'hello') {
      log('hello from server', message.agentId || AGENT_ID);
      return;
    }

    if (message.type === 'job' || message.type === 'job:new' || message.job) {
      enqueueJob(message.job || message);
    }
  });

  ws.on('close', (code, reason) => {
    clearSocketTimers();
    if (activeWs === ws) activeWs = null;

    log('websocket closed', {
      code,
      reason: reason?.toString() || '(empty)',
      busy: Boolean(activeJobId),
      activeJobId,
      queuedJobs: jobQueue.length,
    });

    log('reconnecting in 3 seconds...');
    scheduleReconnect();
  });

  ws.on('unexpected-response', (_request, response) => {
    log('websocket handshake rejected', {
      statusCode: response.statusCode,
      statusMessage: response.statusMessage,
    });
  });

  ws.on('error', error => {
    log('websocket error', {
      message: error?.message,
      code: error?.code,
      busy: Boolean(activeJobId),
      activeJobId,
    });
  });
}

refreshCupsHealth({ logChanges: true }).catch(error => {
  log('initial CUPS health check failed', error?.message || error);
});

const cupsHealthTimer = setInterval(() => {
  if (activeJobId) return;
  refreshCupsHealth({ logChanges: true }).catch(error => {
    log('CUPS health check failed', error?.message || error);
  });
}, Math.max(5000, CUPS_HEALTH_INTERVAL_MS));
cupsHealthTimer.unref?.();

connect();
