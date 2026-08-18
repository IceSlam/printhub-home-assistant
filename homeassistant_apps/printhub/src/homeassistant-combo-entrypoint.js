import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import {
  CupsCommandError,
  getServerStatus,
  listPrinters,
  getPrinter,
  addPrinter,
  updatePrinter,
  deletePrinter,
  printerAction,
  setPrinterOptions,
  listJobs,
  jobAction,
  listClasses,
  createClass,
  updateClass,
  deleteClass,
  listDevices,
  listDrivers,
  uploadPpd,
  getServerSettings,
  updateServerSettings,
  readLogs,
} from './cups-manager.js';

const OPTIONS_PATH = '/data/options.json';
const WEB_ROOT = '/app/web';

function readOptions() {
  try { return JSON.parse(fs.readFileSync(OPTIONS_PATH, 'utf8')); }
  catch (error) {
    console.error(new Date().toISOString(), 'cannot read options', error?.message || error);
    return {};
  }
}
function str(value, fallback = '') { const x = String(value ?? fallback).trim(); return x || String(fallback || '').trim(); }
function bool(value, fallback = false) { if (typeof value === 'boolean') return value; if (value == null || value === '') return fallback; return !['0','false','no','off'].includes(String(value).toLowerCase()); }
function int(value, fallback, min, max) { const n = Math.trunc(Number(value)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; }

const options = readOptions();
const serverUrl = str(options.server_url, 'https://print.iceslam.ru').replace(/\/+$/, '');
const wsUrl = str(options.ws_url, serverUrl.replace(/^https:/,'wss:').replace(/^http:/,'ws:') + '/ws/agent');
const agentToken = str(options.agent_token);
const cupsPrinter = str(options.main_queue, 'XP365B');
const printerDisplayName = str(options.printer_display_name, 'Xprinter XP-365B');
const airprintEnabled = bool(options.airprint_enabled, true);
const airprintQueue = str(process.env.PRINTHUB_AIRPRINT_QUEUE_EFFECTIVE || options.airprint_queue, 'XP365B_AirPrint');
const airprintDisplayName = str(options.airprint_display_name, 'Xprinter XP-365B 58x40');
const airprintSize = str(options.airprint_size, '58x40');
const defaultPageSize = str(options.default_page_size, '58x40');
const darkness = int(options.darkness, 15, 0, 15);
const printSpeed = int(options.print_speed, 12, 1, 12);
const gapMm = int(options.gap_mm, 3, 0, 10);
const statusHost = str(options.status_host, '127.0.0.1');
const statusPort = int(options.status_port, 35994, 1024, 65535);
const webPort = int(options.web_port, 8099, 1024, 65535);
const adminUsername = str(options.admin_username, 'admin');
const adminPassword = str(options.admin_password, 'admin');
const APP_VERSION = '2.2.19';

Object.assign(process.env, {
  SERVER_URL: serverUrl,
  WS_URL: wsUrl,
  AGENT_TOKEN: agentToken,
  AGENT_ID: str(options.agent_id, 'homeassistant-xp365b'),
  PRINTER_CONNECTION_MODE: 'cups',
  PDF_PRINT_MODE: 'cups',
  CUPS_SERVER: '127.0.0.1:631',
  CUPS_PRINTER: cupsPrinter,
  CUPS_PRINTER_USB: cupsPrinter,
  CUPS_PRINTER_IP: '',
  PRINTER_NAME: printerDisplayName,
  PRINT_DPI: String(int(options.print_dpi, 203, 100, 1200)),
  PDF_DETECT_TOLERANCE_MM: String(int(options.pdf_detect_tolerance_mm, 3, 1, 20)),
  CUPS_READY_TIMEOUT_MS: String(int(options.cups_ready_timeout_seconds, 30, 5, 300) * 1000),
  CUPS_HEALTH_INTERVAL_MS: String(int(options.cups_health_interval_seconds, 15, 5, 300) * 1000),
  CUPS_PRINT_RETRIES: String(int(options.cups_print_retries, 3, 1, 10)),
  CUPS_PRINT_RETRY_DELAY_MS: String(int(options.cups_print_retry_delay_seconds, 2, 1, 30) * 1000),
  CUPS_WAIT_FOR_JOB: bool(options.cups_wait_for_job, true) ? 'true' : 'false',
  CUPS_JOB_TIMEOUT_MS: String(int(options.cups_job_timeout_seconds, 90, 10, 600) * 1000),
  CUPS_JOB_POLL_MS: String(int(options.cups_job_poll_ms, 1500, 250, 10000)),
  WS_STATUS_INTERVAL_MS: String(int(options.ws_status_interval_seconds, 10, 5, 120) * 1000),
  WS_NATIVE_PING_MS: String(int(options.ws_native_ping_seconds, 10, 5, 120) * 1000),
  WS_PONG_TIMEOUT_MS: String(int(options.ws_pong_timeout_seconds, 45, 15, 300) * 1000),
});

if (!agentToken) {
  console.warn(new Date().toISOString(), 'PrintHub agent_token is empty: CUPS/UI will run, remote Agent connection is disabled until token is configured.');
}



let agentModule = null;
if (agentToken) {
  agentModule = await import('./agent.js');
}

function agentSnapshot() {
  if (!agentModule) return {
    agentId: process.env.AGENT_ID,
    online: false,
    serverConnected: false,
    disabled: true,
    reason: 'agent_token is not configured',
    printerName: process.env.PRINTER_NAME,
    version: '1.5.1',
  };
  return agentModule.getAgentStatusSnapshot();
}

async function refreshedAgentSnapshot() {
  if (!agentModule) return agentSnapshot();
  return agentModule.refreshAgentStatusSnapshot();
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req, limit = 3 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function isIngress(req) {
  return Boolean(req.headers['x-ingress-path'] || req.headers['x-hass-user'] || req.headers['x-home-assistant-user-name']);
}

function authorized(req) {
  if (isIngress(req)) return true;
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const split = decoded.indexOf(':');
    return decoded.slice(0, split) === adminUsername && decoded.slice(split + 1) === adminPassword;
  } catch { return false; }
}

function requireAuth(req, res) {
  if (authorized(req)) return true;
  res.writeHead(401, { 'www-authenticate': 'Basic realm="PrintHub"' });
  res.end('Authentication required');
  return false;
}

function mime(filename) {
  if (filename.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filename.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filename.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filename.endsWith('.svg')) return 'image/svg+xml';
  if (filename.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

async function serveStatic(req, res, pathname) {
  const file = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(WEB_ROOT, file);
  if (!resolved.startsWith(path.resolve(WEB_ROOT))) return false;
  try {
    const data = await fs.promises.readFile(resolved);
    res.writeHead(200, { 'content-type': mime(resolved), 'cache-control': 'no-store, no-cache, must-revalidate', 'pragma': 'no-cache', 'expires': '0' });
    res.end(data);
    return true;
  } catch { return false; }
}

async function overview() {
  // Overview is a status dashboard, not a device-discovery screen. Keep its
  // CUPS probes bounded so a stalled scheduler/backend does not hold the WebUI
  // loader for 15-30 seconds. Dedicated pages retain their longer timeouts.
  const overviewTimeout = 5000;
  const [cups, printers, activeJobs, classes, devices, serverSettings] = await Promise.all([
    getServerStatus({ timeout: overviewTimeout }),
    listPrinters({ timeout: overviewTimeout }),
    listJobs('active', { timeout: overviewTimeout }),
    listClasses({ timeout: overviewTimeout }),
    listDevices({ timeout: overviewTimeout }),
    getServerSettings(),
  ]);

  const mainPrinter = printers.find(item => item.name === cupsPrinter) || null;
  const airprintCandidates = printers.filter(item => /^printhubproxy:\//i.test(String(item.uri || '')) || /printHub airprint/i.test(String(item.location || '')));
  const airprintPrinter =
    airprintCandidates.find(item => item.name === airprintQueue)
    || airprintCandidates.find(item => String(item.description || '').trim() === airprintDisplayName)
    || airprintCandidates[0]
    || printers.find(item => item.name === airprintQueue)
    || null;
  const effectiveAirprintQueue = airprintPrinter?.name || airprintQueue;
  const effectiveAirprintDisplayName = airprintPrinter?.description || airprintDisplayName;
  const usbDevice = devices.find(item => {
    const uri = String(item?.uri || '');
    if (!/^usb:\/\//i.test(uri)) return false;
    if (mainPrinter?.uri && uri === mainPrinter.uri) return true;
    return /xprinter/i.test(uri);
  }) || null;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    app: {
      version: APP_VERSION,
      mode: 'all-in-one',
      webPort,
      cupsPort: 631,
      statusPort,
      mainQueue: cupsPrinter,
      printerDisplayName,
      airprintEnabled,
      airprintQueue: effectiveAirprintQueue,
      airprintDisplayName: effectiveAirprintDisplayName,
      airprintSize,
      defaultPageSize,
      darkness,
      printSpeed,
      gapMm,
    },
    agent: agentSnapshot(),
    cups,
    printers,
    mainPrinter,
    airprintPrinter,
    activeJobs,
    classes,
    devices,
    serverSettings,
    hardware: {
      usbConnected: Boolean(usbDevice),
      usbUri: usbDevice?.uri || null,
    },
    airprint: {
      configured: airprintEnabled,
      ready: Boolean(
        airprintEnabled
        && cups.schedulerRunning
        && airprintPrinter
        && airprintPrinter.enabled
        && airprintPrinter.accepting !== false
      ),
      queue: effectiveAirprintQueue,
      configuredQueue: airprintQueue,
      displayName: effectiveAirprintDisplayName,
      size: airprintSize,
      duplicateQueues: airprintCandidates.map(item => item.name).filter((name, index, all) => all.indexOf(name) === index),
      publication: 'cups-dnssd',
      bonjourPublished: Boolean(airprintPrinter),
      bonjourError: null,
      serviceType: '_ipp._tcp,_universal',
    },
    version: APP_VERSION,
  };
}

async function api(req, res, url) {
  const p = url.pathname;
  const method = req.method || 'GET';

  if (p === '/api/health') {
    const cups = await getServerStatus();
    return sendJson(res, cups.schedulerRunning ? 200 : 503, { ok: cups.schedulerRunning, cups, agent: agentSnapshot(), version: APP_VERSION });
  }
  if (!requireAuth(req, res)) return;

  if (method === 'GET' && p === '/api/overview') return sendJson(res, 200, await overview());
  if (method === 'GET' && p === '/api/agent') return sendJson(res, 200, { agent: url.searchParams.get('refresh') === '1' ? await refreshedAgentSnapshot() : agentSnapshot() });
  if (method === 'GET' && p === '/api/printers') return sendJson(res, 200, { printers: await listPrinters() });
  if (method === 'POST' && p === '/api/printers') return sendJson(res, 201, { printer: await addPrinter(await readJson(req)) });
  if (method === 'GET' && /^\/api\/printers\/[^/]+$/.test(p)) return sendJson(res, 200, { printer: await getPrinter(decodeURIComponent(p.split('/').pop())) });
  if (method === 'PATCH' && /^\/api\/printers\/[^/]+$/.test(p)) return sendJson(res, 200, { printer: await updatePrinter(decodeURIComponent(p.split('/').pop()), await readJson(req)) });
  if (method === 'DELETE' && /^\/api\/printers\/[^/]+$/.test(p)) return sendJson(res, 200, await deletePrinter(decodeURIComponent(p.split('/').pop())));
  if (method === 'POST' && /^\/api\/printers\/[^/]+\/action$/.test(p)) {
    const name = decodeURIComponent(p.split('/')[3]); const body = await readJson(req);
    return sendJson(res, 200, { printer: await printerAction(name, body.action, body) });
  }
  if (method === 'POST' && /^\/api\/printers\/[^/]+\/options$/.test(p)) {
    const name = decodeURIComponent(p.split('/')[3]); const body = await readJson(req);
    return sendJson(res, 200, { printer: await setPrinterOptions(name, body.options || {}) });
  }
  if (method === 'GET' && p === '/api/jobs') return sendJson(res, 200, { jobs: await listJobs(url.searchParams.get('which') || 'active') });
  if (method === 'POST' && /^\/api\/jobs\/[^/]+\/action$/.test(p)) {
    const id = decodeURIComponent(p.split('/')[3]); const body = await readJson(req);
    return sendJson(res, 200, await jobAction(id, body.action, body));
  }
  if (method === 'GET' && p === '/api/classes') return sendJson(res, 200, { classes: await listClasses() });
  if (method === 'POST' && p === '/api/classes') return sendJson(res, 201, { class: await createClass(await readJson(req)) });
  if (method === 'PATCH' && /^\/api\/classes\/[^/]+$/.test(p)) return sendJson(res, 200, { class: await updateClass(decodeURIComponent(p.split('/').pop()), await readJson(req)) });
  if (method === 'DELETE' && /^\/api\/classes\/[^/]+$/.test(p)) return sendJson(res, 200, await deleteClass(decodeURIComponent(p.split('/').pop())));
  if (method === 'GET' && p === '/api/devices') return sendJson(res, 200, { devices: await listDevices() });
  if (method === 'GET' && p === '/api/drivers') return sendJson(res, 200, { drivers: await listDrivers(url.searchParams.get('q') || '') });
  if (method === 'POST' && p === '/api/drivers/upload') {
    const body = await readJson(req, 8 * 1024 * 1024);
    return sendJson(res, 201, { ppd: await uploadPpd(body.filename, body.contentBase64) });
  }
  if (method === 'GET' && p === '/api/server') return sendJson(res, 200, { server: await getServerSettings(), status: await getServerStatus() });
  if (method === 'PATCH' && p === '/api/server') return sendJson(res, 200, { server: await updateServerSettings(await readJson(req)) });
  if (method === 'GET' && p === '/api/logs') return sendJson(res, 200, { logs: await readLogs(url.searchParams.get('lines') || 250) });

  return sendJson(res, 404, { error: 'not_found' });
}

const managementServer = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (!requireAuth(req, res)) return;
    if (await serveStatic(req, res, url.pathname)) return;
    const index = await fs.promises.readFile(path.join(WEB_ROOT, 'index.html'));
    res.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store' });
    res.end(index);
  } catch (error) {
    console.error(new Date().toISOString(), 'management request failed', { path: url.pathname, error: error?.message || String(error), detail: error?.detail });
    if (!res.headersSent) sendJson(res, error instanceof CupsCommandError ? 422 : 500, { error: error?.message || 'internal_error', detail: error?.detail || '' });
    else res.end();
  }
});

managementServer.listen(webPort, '0.0.0.0', () => {
  console.log(new Date().toISOString(), 'PrintHub modern WebUI listening', { port: webPort });
});


function isLoopbackRequest(req) {
  const address = String(req.socket?.remoteAddress || '');
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1';
}

const statusServer = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      const status = agentSnapshot();
      const cups = await getServerStatus();

      return sendJson(res, 200, {
        ok: true,
        ready: Boolean(cups.schedulerRunning && (!agentModule || status.serverConnected)),
        agentId: status.agentId,
        version: status.version,
        appVersion: APP_VERSION,
        cups,
      });
    }

    if (req.method === 'GET' && url.pathname === '/status') {
      const status = url.searchParams.get('refresh') === '1'
        ? await refreshedAgentSnapshot()
        : agentSnapshot();

      return sendJson(res, 200, {
        ok: true,
        generatedAt: new Date().toISOString(),
        appVersion: APP_VERSION,
        agent: status,
      });
    }

    if (req.method === 'GET' && url.pathname === '/overview') {
      return sendJson(res, 200, await overview());
    }

    /*
     * Management actions used by the Home Assistant integration are available
     * only over loopback. Even if status_host is accidentally changed to
     * 0.0.0.0, a LAN client cannot invoke these control endpoints.
     */
    if (req.method === 'POST' && url.pathname === '/control/printer-action') {
      if (!isLoopbackRequest(req)) {
        return sendJson(res, 403, { ok: false, error: 'loopback_only' });
      }

      const body = await readJson(req);
      const printer = String(body.printer || cupsPrinter);
      const action = String(body.action || '');

      if (![cupsPrinter, airprintQueue].includes(printer)) {
        return sendJson(res, 422, { ok: false, error: 'unsupported_printer' });
      }

      if (!['test', 'purge'].includes(action)) {
        return sendJson(res, 422, { ok: false, error: 'unsupported_action' });
      }

      const result = await printerAction(printer, action, body);
      return sendJson(res, 200, { ok: true, printer: result });
    }

    if (!['GET', 'POST'].includes(req.method || '')) {
      return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    console.error(new Date().toISOString(), 'local status API request failed', {
      path: url.pathname,
      error: error?.message || String(error),
      detail: error?.detail || '',
    });

    return sendJson(
      res,
      error instanceof CupsCommandError ? 422 : 500,
      {
        ok: false,
        error: error?.message || 'internal_error',
        detail: error?.detail || '',
      },
    );
  }
});
statusServer.listen(statusPort, statusHost, () => console.log(new Date().toISOString(), 'PrintHub local status API listening', { url:`http://${statusHost}:${statusPort}/status` }));

