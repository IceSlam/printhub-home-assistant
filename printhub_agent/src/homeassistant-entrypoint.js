import fs from 'node:fs';

const OPTIONS_PATH = '/data/options.json';

function readOptions() {
  try {
    return JSON.parse(fs.readFileSync(OPTIONS_PATH, 'utf8'));
  } catch (error) {
    console.error(new Date().toISOString(), 'cannot read Home Assistant App options', {
      path: OPTIONS_PATH,
      error: error?.message || String(error),
    });
    return {};
  }
}

function str(value, fallback = '') {
  const result = String(value ?? fallback).trim();
  return result || String(fallback || '').trim();
}

function bool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value == null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function int(value, fallback, min, max) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const options = readOptions();

const serverUrl = str(options.server_url, 'https://print.iceslam.ru').replace(/\/+$/, '');
const wsUrl = str(
  options.ws_url,
  serverUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + '/ws/agent'
);

const agentToken = str(options.agent_token);
if (!agentToken) {
  console.error('');
  console.error('==============================================================');
  console.error(' PrintHub Agent: не указан agent_token');
  console.error(' Откройте Settings → Apps → PrintHub Agent → Configuration');
  console.error(' и укажите тот же AGENT_TOKEN, что настроен на PrintHub Server.');
  console.error('==============================================================');
  console.error('');
  process.exit(78);
}

const cupsServer = str(options.cups_server, '127.0.0.1:631');
const cupsPrinter = str(options.cups_printer, 'XP365B');

Object.assign(process.env, {
  SERVER_URL: serverUrl,
  WS_URL: wsUrl,
  AGENT_TOKEN: agentToken,
  AGENT_ID: str(options.agent_id, 'homeassistant-xp365b'),

  // Home Assistant architecture:
  // PrintHub Agent -> TCP/IPP -> CUPS App -> USB/network printer.
  PRINTER_CONNECTION_MODE: 'cups',
  PDF_PRINT_MODE: 'cups',
  CUPS_SERVER: cupsServer,
  CUPS_PRINTER: cupsPrinter,
  CUPS_PRINTER_USB: cupsPrinter,
  CUPS_PRINTER_IP: '',

  PRINTER_NAME: str(options.printer_name, 'Xprinter XP-365B'),
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

console.log(new Date().toISOString(), 'Home Assistant PrintHub Agent bootstrap', {
  serverUrl: process.env.SERVER_URL,
  wsUrl: process.env.WS_URL,
  agentId: process.env.AGENT_ID,
  cupsServer: process.env.CUPS_SERVER,
  cupsPrinter: process.env.CUPS_PRINTER,
  cupsWaitForJob: process.env.CUPS_WAIT_FOR_JOB,
});

// Probe is informative only. The shared agent keeps retrying if CUPS starts later.
const { execFile } = await import('node:child_process');
await new Promise(resolve => {
  execFile(
    'lpstat',
    ['-r'],
    {
      env: { ...process.env },
      timeout: 8000,
    },
    (error, stdout, stderr) => {
      if (error) {
        console.warn(new Date().toISOString(), 'CUPS preflight unavailable; agent will keep retrying', {
          cupsServer,
          detail: String(stderr || error.message || error).trim(),
        });
      } else {
        console.log(new Date().toISOString(), 'CUPS preflight', String(stdout || stderr).trim());
      }
      resolve();
    },
  );
});

await import('./agent.js');
