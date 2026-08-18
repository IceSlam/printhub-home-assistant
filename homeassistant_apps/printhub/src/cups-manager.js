import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const CUPS_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C', CUPS_SERVER: '127.0.0.1:631', CUPS_USER: 'root', HOME: '/root' };
const CUPSD_CONF = '/etc/cups/cupsd.conf';
const CUPSD_PID = '/run/cups/cupsd.pid';

export class CupsCommandError extends Error {
  constructor(message, detail = '') {
    super(message);
    this.name = 'CupsCommandError';
    this.detail = detail;
  }
}

async function run(command, args = [], { timeout = 15000, allowFailure = false } = {}) {
  try {
    const { stdout = '', stderr = '' } = await execFileAsync(command, args, {
      env: CUPS_ENV,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout: String(stdout).trim(), stderr: String(stderr).trim(), ok: true };
  } catch (error) {
    const stdout = String(error?.stdout || '').trim();
    const stderr = String(error?.stderr || error?.message || error || '').trim();
    if (allowFailure) return { stdout, stderr, ok: false };
    throw new CupsCommandError(`${command} failed`, stderr || stdout);
  }
}

function validateName(name) {
  const value = String(name || '').trim();
  if (!/^[A-Za-z0-9_.-]{1,127}$/.test(value)) {
    throw new CupsCommandError('Invalid destination name', 'Use letters, digits, dot, dash or underscore only.');
  }
  return value;
}

function parseDeviceMap(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^device for\s+(.+?):\s+(.+)$/i);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

function parsePrinterBlocks(text) {
  const items = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const head = line.match(/^printer\s+(\S+)\s+(.+)$/i);
    if (head) {
      current = { name: head[1], stateText: head[2], details: {} };
      items.push(current);
      continue;
    }
    if (!current) continue;
    const detail = line.match(/^\s+([^:]+):\s*(.*)$/);
    if (detail) current.details[detail[1].trim()] = detail[2].trim();
  }
  return items;
}

function parseClasses(text) {
  const classes = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const head = line.match(/^members of class\s+(\S+):/i);
    if (head) {
      current = { name: head[1], members: [] };
      classes.push(current);
      continue;
    }
    if (current && /^\s+\S+/.test(line)) current.members.push(line.trim());
  }
  return classes;
}

function parseAccepted(text) {
  const result = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s+(accepting|not accepting) requests/i);
    if (m) result.set(m[1], m[2].toLowerCase().startsWith('accepting'));
  }
  return result;
}

function parseJobs(text, completed = false) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/^(.+)-(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    rows.push({
      id: `${m[1]}-${m[2]}`,
      destination: m[1],
      jobId: Number(m[2]),
      owner: m[3],
      sizeBytes: Number(m[4]),
      dateText: m[5],
      completed,
    });
  }
  return rows;
}

function parseOptionsList(text) {
  const result = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\S+)\/([^:]+):\s*(.*)$/);
    if (!m) continue;
    const choices = m[3].split(/\s+/).filter(Boolean).map(choice => ({
      value: choice.replace(/^\*/, ''),
      selected: choice.startsWith('*'),
    }));
    result.push({ key: m[1], label: m[2].trim(), choices });
  }
  return result;
}

function boolFromConfig(text, directive, fallback = false) {
  const match = text.match(new RegExp(`^\\s*${directive}\\s+(Yes|No)\\s*$`, 'im'));
  return match ? match[1].toLowerCase() === 'yes' : fallback;
}

function blockFor(text, location) {
  const escaped = location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.match(new RegExp(`<Location\\s+${escaped}>[\\s\\S]*?<\\/Location>`, 'i'))?.[0] || '';
}

function detectServerSettings(text) {
  const rootBlock = blockFor(text, '/');
  const adminBlock = blockFor(text, '/admin');
  const cancelBlock = text.match(/<Limit\s+Cancel-Job\s+CUPS-Authenticate-Job>[\s\S]*?<\/Limit>/i)?.[0] || '';
  const logLevel = text.match(/^\s*LogLevel\s+(\S+)/im)?.[1]?.toLowerCase() || 'warn';

  return {
    raw: {},
    sharePrinters: boolFromConfig(text, 'Browsing', true) && boolFromConfig(text, 'DefaultShared', true),
    remoteAdmin: /Allow\s+(?:@LOCAL|all|10\.0\.0\.0\/8|172\.16\.0\.0\/12|192\.168\.0\.0\/16)/i.test(adminBlock),
    remoteAny: /Allow\s+all/i.test(rootBlock) || /Allow\s+all/i.test(adminBlock),
    userCancelAny: !/Require\s+user\s+@OWNER\s+@SYSTEM/i.test(cancelBlock),
    debugLogging: logLevel === 'debug' || logLevel === 'debug2',
    webInterface: boolFromConfig(text, 'WebInterface', true),
  };
}

function accessLines(mode) {
  if (mode === 'all') return '  Allow all';
  if (mode === 'localnet') return [
    '  Allow localhost',
    '  Allow @LOCAL',
    '  Allow 10.0.0.0/8',
    '  Allow 172.16.0.0/12',
    '  Allow 192.168.0.0/16',
  ].join('\n');
  return '  Allow localhost';
}

function renderCupsdConf(settings) {
  const publicAccess = settings.remoteAny ? 'all' : (settings.sharePrinters ? 'localnet' : 'localhost');
  const adminAccess = settings.remoteAdmin
    ? (settings.remoteAny ? 'all' : 'localnet')
    : 'localhost';
  const cancelAuth = settings.userCancelAny ? '' : '    Require user @OWNER @SYSTEM\n';

  return `LogLevel ${settings.debugLogging ? 'debug' : 'warn'}
ErrorLog /data/cups/log/error_log
AccessLog /data/cups/log/access_log
PageLog /data/cups/log/page_log

Listen 0.0.0.0:631
Listen /run/cups/cups.sock
ServerAlias *
WebInterface ${settings.webInterface ? 'Yes' : 'No'}

Browsing ${settings.sharePrinters ? 'Yes' : 'No'}
BrowseLocalProtocols dnssd
BrowseDNSSDSubTypes _cups,_print,_universal
BrowseWebIF No
DefaultShared ${settings.sharePrinters ? 'Yes' : 'No'}

DefaultAuthType Basic
JobSheets none,none
PreserveJobHistory Yes
PreserveJobFiles Yes
MaxJobs 500

<Location />
  Order allow,deny
${accessLines(publicAccess)}
</Location>

<Location /admin>
  AuthType Basic
  Require user @SYSTEM
  Order allow,deny
${accessLines(adminAccess)}
</Location>

<Location /admin/conf>
  AuthType Basic
  Require user @SYSTEM
  Order allow,deny
${accessLines(adminAccess)}
</Location>

<Policy default>
  <Limit Create-Job Print-Job Print-URI Validate-Job Send-Document Send-URI Close-Job>
    # AirPrint/iOS may use Create-Job + Send-Document with a requesting-user-name
    # that has no matching local UNIX account. Keep the print data path
    # unauthenticated; network access is still constrained by <Location />.
    Order deny,allow
  </Limit>
  <Limit Hold-Job Release-Job Restart-Job Purge-Jobs Set-Job-Attributes Create-Job-Subscription Renew-Subscription Cancel-Subscription Get-Notifications Reprocess-Job Cancel-Current-Job Suspend-Current-Job Resume-Current-Job Cancel-My-Jobs CUPS-Move-Job CUPS-Get-Document>
    Require user @OWNER @SYSTEM
    Order deny,allow
  </Limit>
  <Limit CUPS-Add-Modify-Printer CUPS-Delete-Printer CUPS-Add-Modify-Class CUPS-Delete-Class CUPS-Set-Default CUPS-Get-Devices>
    AuthType Default
    Require user @SYSTEM
    Order deny,allow
  </Limit>
  <Limit Pause-Printer Resume-Printer Enable-Printer Disable-Printer Pause-Printer-After-Current-Job Hold-New-Jobs Release-Held-New-Jobs Deactivate-Printer Activate-Printer Restart-Printer Shutdown-Printer Startup-Printer Promote-Job Schedule-Job-After CUPS-Accept-Jobs CUPS-Reject-Jobs>
    AuthType Default
    Require user @SYSTEM
    Order deny,allow
  </Limit>
  <Limit Cancel-Job CUPS-Authenticate-Job>
${cancelAuth}    Order deny,allow
  </Limit>
  <Limit All>
    Order deny,allow
  </Limit>
</Policy>
`;
}

async function readCupsdConf() {
  try { return await fs.readFile(CUPSD_CONF, 'utf8'); }
  catch (error) { throw new CupsCommandError('Не удалось прочитать cupsd.conf', error?.message || String(error)); }
}

async function signalCupsd() {
  let pid = 0;
  try { pid = Number((await fs.readFile(CUPSD_PID, 'utf8')).trim()); }
  catch { pid = 0; }

  if (!Number.isFinite(pid) || pid <= 1) {
    try {
      const entries = await fs.readdir('/proc');
      for (const entry of entries) {
        if (!/^\d+$/.test(entry)) continue;
        try {
          const comm = (await fs.readFile(`/proc/${entry}/comm`, 'utf8')).trim();
          if (comm === 'cupsd') { pid = Number(entry); break; }
        } catch {}
      }
    } catch {}
  }

  if (!Number.isFinite(pid) || pid <= 1) {
    throw new CupsCommandError('Не найден PID CUPS scheduler', CUPSD_PID);
  }

  try { process.kill(pid, 'SIGHUP'); }
  catch (error) { throw new CupsCommandError('Не удалось перезагрузить CUPS', error?.message || String(error)); }
  await new Promise(resolve => setTimeout(resolve, 450));
}

async function applyServerSettings(settings) {
  const previous = await readCupsdConf();
  const next = renderCupsdConf(settings);
  const temp = `${CUPSD_CONF}.printhub-new`;

  await fs.writeFile(temp, next, 'utf8');
  await fs.rename(temp, CUPSD_CONF);

  const test = await run('/usr/sbin/cupsd', ['-t'], { allowFailure: true, timeout: 15000 });
  if (!test.ok) {
    await fs.writeFile(CUPSD_CONF, previous, 'utf8');
    throw new CupsCommandError('Новые настройки CUPS не прошли проверку', test.stderr || test.stdout);
  }

  try {
    await signalCupsd();
    const status = await run('lpstat', ['-r'], { allowFailure: true, timeout: 5000 });
    if (!/scheduler is running/i.test(status.stdout)) throw new Error(status.stderr || status.stdout || 'scheduler unavailable');
  } catch (error) {
    await fs.writeFile(CUPSD_CONF, previous, 'utf8');
    try { await signalCupsd(); } catch {}
    if (error instanceof CupsCommandError) throw error;
    throw new CupsCommandError('CUPS не применил новые настройки; выполнен откат', error?.message || String(error));
  }
}

export async function getServerSettings() {
  return detectServerSettings(await readCupsdConf());
}

export async function getServerStatus({ timeout = 15000 } = {}) {
  const [scheduler, defaultDest, settings] = await Promise.all([
    run('lpstat', ['-r'], { allowFailure: true, timeout }),
    run('lpstat', ['-d'], { allowFailure: true, timeout }),
    getServerSettings().catch(() => null),
  ]);
  return {
    schedulerRunning: /scheduler is running/i.test(scheduler.stdout),
    schedulerText: scheduler.stdout || scheduler.stderr || 'unknown',
    defaultDestination: defaultDest.stdout.match(/system default destination:\s*(\S+)/i)?.[1] || null,
    settings: settings || {},
  };
}

export async function listPrinters({ timeout = 15000 } = {}) {
  const [printerResult, deviceResult, acceptedResult, defaultResult, classResult] = await Promise.all([
    run('lpstat', ['-p', '-l'], { allowFailure: true, timeout }),
    run('lpstat', ['-v'], { allowFailure: true, timeout }),
    run('lpstat', ['-a'], { allowFailure: true, timeout }),
    run('lpstat', ['-d'], { allowFailure: true, timeout }),
    run('lpstat', ['-c'], { allowFailure: true, timeout }),
  ]);

  const devices = parseDeviceMap(deviceResult.stdout);
  const accepted = parseAccepted(acceptedResult.stdout);
  const defaultName = defaultResult.stdout.match(/system default destination:\s*(\S+)/i)?.[1] || null;
  const classes = new Set(parseClasses(classResult.stdout).map(item => item.name));

  return parsePrinterBlocks(printerResult.stdout).map(item => ({
    name: item.name,
    uri: devices.get(item.name) || null,
    description: item.details.Description || '',
    location: item.details.Location || '',
    enabled: !/disabled/i.test(item.stateText),
    stateText: item.stateText,
    accepting: accepted.get(item.name) ?? null,
    isDefault: item.name === defaultName,
    isClass: classes.has(item.name),
    details: item.details,
  }));
}

export async function getPrinter(name) {
  name = validateName(name);
  const printers = await listPrinters();
  const printer = printers.find(item => item.name === name);
  if (!printer) throw new CupsCommandError('Printer not found');
  const defaults = await run('lpoptions', ['-p', name], { allowFailure: true });
  const options = await run('lpoptions', ['-p', name, '-l'], { allowFailure: true });
  return { ...printer, defaults: defaults.stdout, options: parseOptionsList(options.stdout) };
}

export async function addPrinter(payload = {}) {
  const name = validateName(payload.name);
  const uri = String(payload.uri || '').trim();
  if (!uri) throw new CupsCommandError('Device URI is required');

  const args = ['-p', name, '-E', '-v', uri];
  if (payload.ppdPath) args.push('-P', String(payload.ppdPath));
  else args.push('-m', String(payload.model || 'everywhere'));
  if (payload.description) args.push('-D', String(payload.description));
  if (payload.location) args.push('-L', String(payload.location));
  args.push('-o', `printer-is-shared=${payload.shared ? 'true' : 'false'}`);

  await run('lpadmin', args, { timeout: 30000 });
  if (payload.accepting !== false) await run('cupsaccept', [name], { allowFailure: true });
  if (payload.enabled !== false) await run('cupsenable', [name], { allowFailure: true });
  if (payload.default) await run('lpadmin', ['-d', name]);
  if (payload.allowedUsers?.length) {
    const mode = payload.allowedMode === 'deny' ? 'deny' : 'allow';
    await run('lpadmin', ['-p', name, '-u', `${mode}:${payload.allowedUsers.join(',')}`]);
  }
  return getPrinter(name);
}

export async function updatePrinter(name, payload = {}) {
  name = validateName(name);
  const args = ['-p', name];
  if (payload.uri) args.push('-v', String(payload.uri));
  if (payload.ppdPath) args.push('-P', String(payload.ppdPath));
  else if (payload.model) args.push('-m', String(payload.model));
  if (payload.description !== undefined) args.push('-D', String(payload.description || ''));
  if (payload.location !== undefined) args.push('-L', String(payload.location || ''));
  if (payload.shared !== undefined) args.push('-o', `printer-is-shared=${payload.shared ? 'true' : 'false'}`);
  if (args.length > 2) await run('lpadmin', args);
  if (payload.allowedUsers) {
    const mode = payload.allowedMode === 'deny' ? 'deny' : 'allow';
    await run('lpadmin', ['-p', name, '-u', `${mode}:${payload.allowedUsers.join(',')}`]);
  }
  return getPrinter(name);
}

export async function deletePrinter(name) {
  name = validateName(name);
  await run('lpadmin', ['-x', name]);
  return { ok: true };
}

export async function printerAction(name, action, payload = {}) {
  name = validateName(name);
  switch (action) {
    case 'enable': await run('cupsenable', [name]); break;
    case 'disable': await run('cupsdisable', [name]); break;
    case 'accept': await run('cupsaccept', [name]); break;
    case 'reject': await run('cupsreject', ['-r', String(payload.reason || 'Stopped from PrintHub'), name]); break;
    case 'default': await run('lpadmin', ['-d', name]); break;
    case 'share': await run('lpadmin', ['-p', name, '-o', `printer-is-shared=${payload.shared ? 'true' : 'false'}`]); break;
    case 'test': await run('lp', ['-d', name, '/usr/share/cups/data/testprint'], { timeout: 30000 }); break;
    case 'purge': await run('cancel', ['-a', name]); break;
    default: throw new CupsCommandError('Unknown printer action');
  }
  return getPrinter(name).catch(() => ({ ok: true }));
}

export async function setPrinterOptions(name, options = {}) {
  name = validateName(name);
  const args = ['-p', name];
  for (const [key, value] of Object.entries(options)) {
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) continue;
    args.push('-o', `${key}=${String(value)}`);
  }
  if (args.length <= 2) throw new CupsCommandError('No options supplied');
  await run('lpadmin', args);
  return getPrinter(name);
}

export async function listJobs(which = 'active', { timeout = 15000 } = {}) {
  if (which === 'completed') {
    const result = await run('lpstat', ['-W', 'completed', '-o'], { allowFailure: true, timeout });
    return parseJobs(result.stdout, true);
  }
  if (which === 'all') {
    const [active, completed] = await Promise.all([
      run('lpstat', ['-W', 'not-completed', '-o'], { allowFailure: true, timeout }),
      run('lpstat', ['-W', 'completed', '-o'], { allowFailure: true, timeout }),
    ]);
    return [...parseJobs(active.stdout, false), ...parseJobs(completed.stdout, true)];
  }
  const result = await run('lpstat', ['-W', 'not-completed', '-o'], { allowFailure: true, timeout });
  return parseJobs(result.stdout, false);
}

export async function jobAction(id, action, payload = {}) {
  const job = String(id || '').trim();
  if (!/^[A-Za-z0-9_.-]+-\d+$/.test(job)) throw new CupsCommandError('Invalid job id');
  switch (action) {
    case 'cancel': await run('cancel', [job]); break;
    case 'hold': await run('lp', ['-i', job, '-H', 'hold']); break;
    case 'release': await run('lp', ['-i', job, '-H', 'resume']); break;
    case 'restart': await run('lp', ['-i', job, '-H', 'restart']); break;
    case 'move':
      if (!payload.destination) throw new CupsCommandError('Destination is required');
      await run('lpmove', [job, validateName(payload.destination)]);
      break;
    default: throw new CupsCommandError('Unknown job action');
  }
  return { ok: true };
}

export async function listClasses({ timeout = 15000 } = {}) {
  const [classResult, defaultResult] = await Promise.all([
    run('lpstat', ['-c'], { allowFailure: true, timeout }),
    run('lpstat', ['-d'], { allowFailure: true, timeout }),
  ]);
  const defaultName = defaultResult.stdout.match(/system default destination:\s*(\S+)/i)?.[1] || null;
  return parseClasses(classResult.stdout).map(item => ({ ...item, isDefault: item.name === defaultName }));
}

export async function createClass(payload = {}) {
  const name = validateName(payload.name);
  const members = Array.isArray(payload.members) ? payload.members.map(validateName) : [];
  if (!members.length) throw new CupsCommandError('A class needs at least one printer');
  for (const member of members) await run('lpadmin', ['-p', member, '-c', name]);
  if (payload.default) await run('lpadmin', ['-d', name]);
  return (await listClasses()).find(item => item.name === name);
}

export async function updateClass(name, payload = {}) {
  name = validateName(name);
  const classes = await listClasses();
  const current = classes.find(item => item.name === name);
  if (!current) throw new CupsCommandError('Class not found');
  const next = new Set((payload.members || []).map(validateName));
  const previous = new Set(current.members);
  for (const member of previous) if (!next.has(member)) await run('lpadmin', ['-p', member, '-r', name]);
  for (const member of next) if (!previous.has(member)) await run('lpadmin', ['-p', member, '-c', name]);
  if (payload.default) await run('lpadmin', ['-d', name]);
  return (await listClasses()).find(item => item.name === name);
}

export async function deleteClass(name) {
  await run('lpadmin', ['-x', validateName(name)]);
  return { ok: true };
}

export async function listDevices({ timeout = 30000 } = {}) {
  const result = await run('lpinfo', ['-v'], { timeout, allowFailure: true });
  return result.stdout.split(/\r?\n/).filter(Boolean).map(line => {
    const m = line.match(/^(\S+)\s+(.+)$/);
    return m ? { type: m[1], uri: m[2] } : { type: 'unknown', uri: line };
  });
}

export async function listDrivers(query = '') {
  const result = await run('lpinfo', ['-m'], { timeout: 30000, allowFailure: true });
  const q = String(query || '').toLowerCase();
  const rows = result.stdout.split(/\r?\n/).filter(Boolean).map(line => {
    const space = line.indexOf(' ');
    return { model: space > 0 ? line.slice(0, space) : line, description: space > 0 ? line.slice(space + 1).replace(/^"|"$/g, '') : '' };
  });
  return (q ? rows.filter(item => `${item.model} ${item.description}`.toLowerCase().includes(q)) : rows).slice(0, 600);
}

export async function uploadPpd(filename, base64) {
  const safe = path.basename(String(filename || 'custom.ppd')).replace(/[^A-Za-z0-9_.-]/g, '_');
  if (!safe.toLowerCase().endsWith('.ppd')) throw new CupsCommandError('Only .ppd files are accepted');
  const dir = '/data/cups/custom-models';
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, safe);
  await fs.writeFile(target, Buffer.from(String(base64 || ''), 'base64'));
  const test = await run('cupstestppd', ['-W', 'all', target], { allowFailure: true });
  if (!test.ok) {
    await fs.rm(target, { force: true });
    throw new CupsCommandError('PPD validation failed', test.stdout || test.stderr);
  }
  return { path: target, filename: safe, validation: test.stdout || 'PASS' };
}

export async function updateServerSettings(payload = {}) {
  const current = await getServerSettings();
  const next = {
    ...current,
    ...Object.fromEntries(
      ['sharePrinters', 'remoteAdmin', 'remoteAny', 'userCancelAny', 'debugLogging', 'webInterface']
        .filter(key => payload[key] !== undefined)
        .map(key => [key, Boolean(payload[key])]),
    ),
  };

  await applyServerSettings(next);
  return getServerSettings();
}

export async function readLogs(lines = 250) {
  const count = Math.max(20, Math.min(2000, Number(lines) || 250));
  const files = ['error_log', 'access_log', 'page_log'];
  const result = {};
  for (const file of files) {
    try {
      const content = await fs.readFile(`/data/cups/log/${file}`, 'utf8');
      result[file] = content.split(/\r?\n/).slice(-count).join('\n');
    } catch {
      result[file] = '';
    }
  }
  return result;
}
