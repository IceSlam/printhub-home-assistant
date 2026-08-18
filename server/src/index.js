import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import { WebSocketServer } from 'ws';
import TelegramBot from 'node-telegram-bot-api';
import { nanoid } from 'nanoid';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateTelegramInitData } from './telegram-auth.js';
import { collectMarketplacePrintables, downloadMarketplacePrintable } from './marketplaces/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || '/app/data';
const JOBS_DIR = path.join(DATA_DIR, 'jobs');
const DB_FILE = path.join(DATA_DIR, 'jobs.json');
const LIBRARY_DIR = path.join(DATA_DIR, 'library');
const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');
const PREVIEW_DIR = path.join(DATA_DIR, 'previews');
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const WEBAPP_URL = (process.env.WEBAPP_URL || `${PUBLIC_URL}/webapp/`).replace(/\/$/, '/');
const AGENT_TOKEN = requiredEnv('AGENT_TOKEN');
const DEFAULT_AGENT_ID = process.env.DEFAULT_AGENT_ID || 'office-xp365b';
const TELEGRAM_BOT_TOKEN = requiredEnv('TELEGRAM_BOT_TOKEN');
const TELEGRAM_ALLOWED_USER_IDS = (process.env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').map(v => v.trim()).filter(Boolean);
const TELEGRAM_MODE = (process.env.TELEGRAM_MODE || 'polling').toLowerCase();
const BOT_PUBLIC_URL = (process.env.BOT_PUBLIC_URL || PUBLIC_URL).replace(/\/$/, '');
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const TELEGRAM_WEBHOOK_PATH = process.env.TELEGRAM_WEBHOOK_PATH || `/telegram/${TELEGRAM_WEBHOOK_SECRET || 'webhook'}`;
const DEFAULT_COPIES = Number(process.env.DEFAULT_COPIES || 1);
const MARKETPLACE_CACHE_MS = Number(process.env.MARKETPLACE_CACHE_MS || 20000);
const WEBAPP_INITDATA_MAX_AGE = Number(process.env.WEBAPP_INITDATA_MAX_AGE || 86400);
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';
const MARKETPLACE_NOTIFY_MS = Number(process.env.MARKETPLACE_NOTIFY_MS || 30000);
const MARKETPLACE_NOTIFY_INITIAL = String(process.env.MARKETPLACE_NOTIFY_INITIAL || 'false').toLowerCase() === 'true';
const MARKETPLACE_STATE_FILE = path.join(DATA_DIR, 'marketplace-state.json');

const LABELS = {
  '58x40': { name: '58×40', widthMm: 58, heightMm: 40 },
  '40x58': { name: '40×58', widthMm: 40, heightMm: 58 },
  '58x60': { name: '58×60', widthMm: 58, heightMm: 60 },
  '75x120': { name: '75×120', widthMm: 75, heightMm: 120 },
  '120x75': { name: '120×75', widthMm: 120, heightMm: 75 },
};

if (TELEGRAM_ALLOWED_USER_IDS.length !== 2) {
  console.warn(`WARNING: TELEGRAM_ALLOWED_USER_IDS contains ${TELEGRAM_ALLOWED_USER_IDS.length} IDs; project is intended for exactly 2 admins.`);
}

await fs.mkdir(JOBS_DIR, { recursive: true });
await fs.mkdir(LIBRARY_DIR, { recursive: true });
await fs.mkdir(PREVIEW_DIR, { recursive: true });
const app = Fastify({ logger: true, bodyLimit: 128 * 1024 * 1024 });
await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024, files: 1 } });
await app.register(staticPlugin, { root: path.join(__dirname, '../public'), prefix: '/webapp/' });

let jobs = await loadJobs();
let localFiles = await loadLocalFiles();
const agents = new Map();
const execFileAsync = promisify(execFile);
const previewRenderPromises = new Map();

function serializeAgent(agentId, record) {
  if (!record) return {
    agentId,
    online: false,
    connectedAt: null,
    lastSeen: null,
    meta: null,
  };
  return {
    agentId,
    online: Boolean(record.ws && record.ws.readyState === 1),
    connectedAt: record.connectedAt || null,
    lastSeen: record.lastSeen || null,
    meta: record.meta || null,
  };
}

function agentList() {
  return [...agents.entries()].map(([agentId, record]) => serializeAgent(agentId, record));
}

function defaultAgentStatus() {
  return serializeAgent(DEFAULT_AGENT_ID, agents.get(DEFAULT_AGENT_ID));
}
let marketplaceCache = { documents: [], errors: [], refreshedAt: null, expiresAt: 0 };
let marketplaceRefreshPromise = null;
let marketplaceState = await loadMarketplaceState();

function requiredEnv(name) { const v = process.env[name]; if (!v) throw new Error(`Missing required env ${name}`); return v; }
function now() { return new Date().toISOString(); }
function safeTokenEqual(a,b){
  const aa=Buffer.from(String(a||''),'utf8');
  const bb=Buffer.from(String(b||''),'utf8');
  return aa.length===bb.length && aa.length>0 && crypto.timingSafeEqual(aa,bb);
}
async function loadJobs(){ try{return JSON.parse(await fs.readFile(DB_FILE,'utf8'));}catch{return [];} }
async function saveJobs(){ await fs.writeFile(DB_FILE, JSON.stringify(jobs,null,2)); }
async function loadLocalFiles(){
  try {
    const data=JSON.parse(await fs.readFile(LIBRARY_FILE,'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
async function saveLocalFiles(){ await fs.writeFile(LIBRARY_FILE, JSON.stringify(localFiles,null,2)); }
function normalizeCopies(value){
  const n=Math.trunc(Number(value||1));
  return Number.isFinite(n) ? Math.min(99,Math.max(1,n)) : 1;
}
function normalizeLibraryName(value,fallback='Файл'){
  const name=String(value||'').trim().replace(/[\r\n\t]+/g,' ').slice(0,140);
  return name || fallback;
}
function publicLocalFile(file){
  const {localPath,previewError,...safe}=file;
  return {
    ...safe,
    pageCount:Number(file.pageCount||1),
    hasPreview:true,
  };
}
function historyItem(job){
  return {
    id:job.id,
    title:job.title,
    status:job.status,
    source:job.source,
    marketplace:job.marketplace||null,
    copies:job.copies||1,
    profile:job.profile||null,
    createdAt:job.createdAt,
    sentAt:job.sentAt||null,
    doneAt:job.doneAt||null,
    updatedAt:job.updatedAt||null,
    error:job.error||null,
    triggeredBy:job.meta?.trigger||null,
  };
}

async function pdfPageCountBuffer(buffer){
  const pdf=await PDFDocument.load(buffer,{ignoreEncryption:true});
  return pdf.getPageCount();
}

function previewSpec(size){
  if(size==='full') return {name:'full',width:1400,dpi:300,quality:88};
  return {name:'thumb',width:520,dpi:180,quality:82};
}

function previewFilePath(item,page,size){
  const spec=previewSpec(size);
  return path.join(PREVIEW_DIR,item.id,`${spec.name}-page-${page}.webp`);
}

async function ensureLibraryPageCount(item){
  const existing=Math.trunc(Number(item.pageCount||0));
  if(existing>0) return existing;
  if(!item.localPath || !fss.existsSync(item.localPath)) return 0;

  const buffer=await fs.readFile(item.localPath);
  const count=await pdfPageCountBuffer(buffer);
  item.pageCount=count;
  item.updatedAt=item.updatedAt||now();
  return count;
}

async function renderLibraryPreview(item,page=1,size='thumb'){
  if(!item?.localPath || !fss.existsSync(item.localPath)){
    throw new Error('Исходный PDF локальной библиотеки не найден');
  }

  const pageCount=await ensureLibraryPageCount(item);
  const requestedPage=Math.trunc(Number(page||1));
  if(!Number.isFinite(requestedPage) || requestedPage<1 || requestedPage>pageCount){
    throw new Error(`Страница ${requestedPage} вне диапазона 1–${pageCount}`);
  }

  const spec=previewSpec(size);
  const target=previewFilePath(item,requestedPage,spec.name);
  if(fss.existsSync(target)) return target;

  const renderKey=`${item.id}:${requestedPage}:${spec.name}`;
  if(previewRenderPromises.has(renderKey)) return previewRenderPromises.get(renderKey);

  const promise=(async()=>{
    const dir=path.dirname(target);
    await fs.mkdir(dir,{recursive:true});

    const prefix=path.join(dir,`.render-${nanoid(8)}`);
    const pngPath=`${prefix}.png`;

    try{
      await execFileAsync('pdftoppm',[
        '-f',String(requestedPage),
        '-l',String(requestedPage),
        '-singlefile',
        '-png',
        '-r',String(spec.dpi),
        item.localPath,
        prefix,
      ],{
        timeout:30000,
        maxBuffer:1024*1024,
      });

      await sharp(pngPath)
        .rotate()
        .flatten({background:'#ffffff'})
        .resize({
          width:spec.width,
          fit:'inside',
          withoutEnlargement:false,
        })
        .webp({quality:spec.quality,effort:4})
        .toFile(target);

      return target;
    }finally{
      await fs.rm(pngPath,{force:true}).catch(()=>{});
    }
  })();

  previewRenderPromises.set(renderKey,promise);
  try{
    return await promise;
  }finally{
    previewRenderPromises.delete(renderKey);
  }
}

async function deleteLocalLibraryFile(id){
  const index=localFiles.findIndex(file=>file.id===id);
  if(index<0){
    const error=new Error('Локальный файл не найден');
    error.code='LOCAL_FILE_NOT_FOUND';
    throw error;
  }

  const item=localFiles[index];

  try{
    if(item.localPath){
      await fs.rm(item.localPath,{force:true});
    }

    await fs.rm(path.join(PREVIEW_DIR,item.id),{
      recursive:true,
      force:true
    }).catch(()=>{});

    localFiles.splice(index,1);
    await saveLocalFiles();

    return item;
  }catch(error){
    app.log.error({
      fileId:item.id,
      error:error?.message||String(error)
    },'delete local PDF failed');

    throw error;
  }
}

async function saveToLocalLibrary({buffer,filename,mimetype='application/pdf',profile,detection,userId}){
  const id=nanoid(12);
  const ext=(path.extname(filename)||'.pdf').toLowerCase()==='.pdf'?'.pdf':'.pdf';
  const localPath=path.join(LIBRARY_DIR,`${id}${ext}`);
  await fs.writeFile(localPath,buffer);

  const pageCount=await pdfPageCountBuffer(buffer);
  const item={
    id,
    name:normalizeLibraryName(filename,'label.pdf'),
    originalFilename:filename,
    mimetype,
    profile,
    detection:detection||null,
    pageCount,
    sizeBytes:buffer.length,
    createdAt:now(),
    updatedAt:now(),
    uploadedBy:String(userId||''),
    favorite:false,
    localPath,
  };

  localFiles.unshift(item);
  await saveLocalFiles();

  // Для новых файлов миниатюра создаётся сразу. Ошибка preview не должна
  // отменять сохранение оригинального PDF: галерея сможет повторить рендер лениво.
  try{
    await renderLibraryPreview(item,1,'thumb');
    item.previewGeneratedAt=now();
    item.previewError=null;
    await saveLocalFiles();
  }catch(error){
    item.previewError=String(error?.message||error);
    await saveLocalFiles();
    app.log.warn({fileId:item.id,error:item.previewError},'local PDF thumbnail generation failed');
  }

  return item;
}
async function loadMarketplaceState(){
  try { return JSON.parse(await fs.readFile(MARKETPLACE_STATE_FILE,'utf8')); }
  catch { return { initialized:false, currentKeys:[], updatedAt:null }; }
}
async function saveMarketplaceState(state){ await fs.writeFile(MARKETPLACE_STATE_FILE, JSON.stringify(state,null,2)); }
function printableToken(key){ return crypto.createHash('sha256').update(String(key)).digest('hex').slice(0,20); }
function publicJob(job){ const { localPath, telegram, ...safe }=job; return safe; }
function isAllowedId(id){ return TELEGRAM_ALLOWED_USER_IDS.includes(String(id)); }

function sendAgent(agentId,payload){ const record=agents.get(agentId); const ws=record?.ws; if(!ws || ws.readyState!==1) return false; ws.send(JSON.stringify(payload)); return true; }
async function dispatch(){
  let changed=false;
  for(const job of jobs.filter(j=>j.status==='pending')){
    if(!sendAgent(job.agentId,{type:'job',job:publicJob(job)})) continue;
    job.status='sent'; job.sentAt=now(); job.updatedAt=now(); changed=true;
  }
  if(changed) await saveJobs();
}

function webAppAuth(req, reply, done){
  const result=validateTelegramInitData(String(req.headers['x-telegram-init-data']||''), TELEGRAM_BOT_TOKEN, WEBAPP_INITDATA_MAX_AGE);
  if(!result.ok) return reply.code(401).send({error:'telegram auth failed',reason:result.reason});
  if(!isAllowedId(result.user.id)) return reply.code(403).send({error:'access denied'});
  req.telegramUser=result.user; done();
}
function legacyAdminAuth(req,reply,done){
  if(!ADMIN_API_KEY || req.headers['x-api-key']!==ADMIN_API_KEY) return reply.code(401).send({error:'bad api key'}); done();
}

function detectPdfSizeBuffer(buffer){
  return PDFDocument.load(buffer,{ignoreEncryption:true}).then(pdf=>{
    if(!pdf.getPageCount()) throw new Error('PDF не содержит страниц');
    const {width,height}=pdf.getPage(0).getSize();
    const w=width/72*25.4, h=height/72*25.4;
    const candidates=Object.entries(LABELS).map(([key,v])=>({key,...v,diff:Math.abs(w-v.widthMm)+Math.abs(h-v.heightMm)})).sort((a,b)=>a.diff-b.diff);
    const best=candidates[0];
    return {widthMm:Number(w.toFixed(2)),heightMm:Number(h.toFixed(2)),profile:best.diff<=6?best.key:null,diff:Number(best.diff.toFixed(2))};
  });
}

async function saveUploadedBuffer(buffer, filename='label.pdf'){
  const ext=path.extname(filename)||'.pdf'; const localPath=path.join(JOBS_DIR,`${nanoid(12)}${ext}`); await fs.writeFile(localPath,buffer); return localPath;
}
async function createFileJob({buffer,filename,mimetype='application/pdf',profile,title,source='manual',marketplace=null,telegram=null,meta=null,copies=DEFAULT_COPIES}){
  const localPath=await saveUploadedBuffer(buffer,filename);
  let detected=null; let chosen=profile;
  if(mimetype.includes('pdf') || filename.toLowerCase().endsWith('.pdf')) detected=await detectPdfSizeBuffer(buffer);
  if(!chosen || chosen==='auto') chosen=detected?.profile;
  if(!LABELS[chosen]) { await fs.rm(localPath,{force:true}); throw new Error(`Не удалось уверенно определить размер PDF (${detected?.widthMm||'?'}×${detected?.heightMm||'?'} мм). Выберите 58×40, 58×60 или 75×120 вручную.`); }
  const label=LABELS[chosen]; const id=nanoid(12);
  const job={id,agentId:DEFAULT_AGENT_ID,printer:'xp365b-cups',type:'file',status:'pending',title:title||filename,copies:normalizeCopies(copies),
    source,marketplace,profile:chosen,preset:chosen,labelSize:chosen,widthMm:label.widthMm,heightMm:label.heightMm,dpi:203,
    file:{filename,mimetype},downloadUrl:`${PUBLIC_URL}/agent/jobs/${id}/file?token=${encodeURIComponent(AGENT_TOKEN)}`,
    createdAt:now(),updatedAt:now(),localPath,telegram,detection:detected,meta,error:null};
  jobs.push(job); await saveJobs(); await dispatch(); return job;
}

async function refreshMarketplaceCache(force=false){
  if(!force && Date.now()<marketplaceCache.expiresAt) return marketplaceCache;
  if(marketplaceRefreshPromise) return marketplaceRefreshPromise;
  marketplaceRefreshPromise=(async()=>{
    const result=await collectMarketplacePrintables();
    marketplaceCache={...result,expiresAt:Date.now()+MARKETPLACE_CACHE_MS}; return marketplaceCache;
  })().finally(()=>{marketplaceRefreshPromise=null;});
  return marketplaceRefreshPromise;
}

function marketplaceNotificationKeyboard(item){
  return {inline_keyboard:[
    [{text:'🖨 Печать', callback_data:`mpprint:${printableToken(item.key)}`}],
    [{text:'Открыть панель', web_app:{url:WEBAPP_URL}}]
  ]};
}

function marketplaceNotificationText(item){
  const mp=item.marketplace==='ozon'?'Ozon':item.marketplace==='wb'?'Wildberries':'Яндекс Маркет';
  const size=String(item.size||'auto').replace('x','×');
  return `🆕 Доступен файл для печати

${mp}
${item.title}${item.subtitle?`
${item.subtitle}`:''}${item.itemName?`
Товар: ${item.itemName}`:''}${item.quantityText?`
Количество: ${item.quantityText}`:''}
Размер: ${size}`;
}

async function notifyAllowedUsers(item){
  for(const id of TELEGRAM_ALLOWED_USER_IDS){
    try{
      await bot.sendMessage(id, marketplaceNotificationText(item), {reply_markup:marketplaceNotificationKeyboard(item)});
    }catch(error){
      app.log.warn({userId:id,error:error?.message||String(error)},'telegram marketplace notification failed');
    }
  }
}

async function monitorMarketplacePrintables(){
  try{
    const data=await refreshMarketplaceCache(true);
    const failedMarketplaces=new Set((data.errors||[]).map(e=>e.marketplace));
    const previousItems=Array.isArray(marketplaceState.currentItems)
      ? marketplaceState.currentItems
      : (marketplaceState.currentKeys||[]).map(key=>({key,marketplace:null}));
    const previousKeys=new Set(previousItems.map(x=>x.key));
    const isInitial=!marketplaceState.initialized;
    const newlyAvailable=data.documents.filter(d=>!previousKeys.has(d.key));

    if(!isInitial || MARKETPLACE_NOTIFY_INITIAL){
      for(const item of newlyAvailable) await notifyAllowedUsers(item);
    }

    // Если API конкретной площадки временно упал, не считаем её прошлые
    // документы исчезнувшими. Иначе после восстановления все они выглядели бы
    // как новые и бот прислал бы повторные уведомления.
    const preserved=previousItems.filter(x=>x.marketplace && failedMarketplaces.has(x.marketplace));
    const currentItems=[
      ...data.documents.map(d=>({key:d.key,marketplace:d.marketplace})),
      ...preserved.filter(old=>!data.documents.some(d=>d.key===old.key)),
    ];

    marketplaceState={initialized:true,currentKeys:currentItems.map(x=>x.key),currentItems,updatedAt:now()};
    await saveMarketplaceState(marketplaceState);
  }catch(error){
    app.log.error({error:error?.message||String(error)},'marketplace notification monitor failed');
  }
}

app.get('/', async (_req,reply)=>reply.redirect('/webapp/'));
app.get('/health', async()=>({ok:true,agents:agentList().map(a=>({agentId:a.agentId,online:a.online,lastSeen:a.lastSeen})),jobs:jobs.length,webApp:true}));
app.get('/api/agents',{preHandler:legacyAdminAuth},async()=>({agents:agentList()}));
app.get('/api/jobs',{preHandler:legacyAdminAuth},async()=>jobs.map(publicJob).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));

app.get('/api/webapp/me',{preHandler:webAppAuth},async req=>({
  user:req.telegramUser,
  agent:defaultAgentStatus()
}));
app.get('/api/webapp/agent-status',{preHandler:webAppAuth},async()=>({
  agent:defaultAgentStatus()
}));
app.get('/api/webapp/printables',{preHandler:webAppAuth},async req=>{
  const force=String(req.query?.refresh||'')==='1'; const data=await refreshMarketplaceCache(force);
  return {documents:data.documents,errors:data.errors,refreshedAt:data.refreshedAt,agent:defaultAgentStatus()};
});
app.get('/api/webapp/history',{preHandler:webAppAuth},async req=>{
  const requested=Math.trunc(Number(req.query?.limit||50));
  const limit=Math.min(100,Math.max(1,Number.isFinite(requested)?requested:50));
  return {
    jobs:jobs
      .slice()
      .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0,limit)
      .map(historyItem)
  };
});

app.get('/api/webapp/local-files',{preHandler:webAppAuth},async()=>{
  let changed=false;
  const available=[];

  for(const file of localFiles){
    if(!file.localPath || !fss.existsSync(file.localPath)) continue;

    if(!Number(file.pageCount)){
      try{
        file.pageCount=await ensureLibraryPageCount(file);
        changed=true;
      }catch(error){
        app.log.warn({fileId:file.id,error:error.message},'failed to read local PDF page count');
      }
    }

    if(typeof file.favorite!=='boolean'){
      file.favorite=false;
      changed=true;
    }

    available.push(publicLocalFile(file));
  }

  available.sort((a,b)=>{
    const favoriteDelta=Number(Boolean(b.favorite))-Number(Boolean(a.favorite));
    if(favoriteDelta) return favoriteDelta;
    return String(b.createdAt||'').localeCompare(String(a.createdAt||''));
  });

  if(changed) await saveLocalFiles();
  return {files:available};
});

app.get('/api/webapp/local-files/:id/preview',{preHandler:webAppAuth},async(req,reply)=>{
  const item=localFiles.find(file=>file.id===req.params.id);
  if(!item || !item.localPath || !fss.existsSync(item.localPath)){
    return reply.code(404).send({error:'Локальный файл не найден'});
  }

  const page=Math.trunc(Number(req.query?.page||1));
  const size=String(req.query?.size||'thumb')==='full'?'full':'thumb';

  try{
    const previewPath=await renderLibraryPreview(item,page,size);
    return reply
      .type('image/webp')
      .header('Cache-Control','private, max-age=86400')
      .header('X-Content-Type-Options','nosniff')
      .send(fss.createReadStream(previewPath));
  }catch(error){
    app.log.warn({fileId:item.id,page,size,error:error.message},'local PDF preview failed');
    return reply.code(422).send({error:`Не удалось создать предпросмотр: ${error.message}`});
  }
});

app.patch('/api/webapp/local-files/:id',{preHandler:webAppAuth},async(req,reply)=>{
  const item=localFiles.find(file=>file.id===req.params.id);
  if(!item) return reply.code(404).send({error:'Локальный файл не найден'});

  let changed=false;

  if(Object.prototype.hasOwnProperty.call(req.body||{},'name')){
    item.name=normalizeLibraryName(req.body?.name,item.name);
    changed=true;
  }

  if(Object.prototype.hasOwnProperty.call(req.body||{},'favorite')){
    item.favorite=Boolean(req.body.favorite);
    changed=true;
  }

  if(changed){
    item.updatedAt=now();
    await saveLocalFiles();
  }

  return {file:publicLocalFile(item)};
});


app.delete('/api/webapp/local-files/:id',{preHandler:webAppAuth},async(req,reply)=>{
  try{
    const item=await deleteLocalLibraryFile(req.params.id);

    return {
      ok:true,
      file:publicLocalFile(item)
    };
  }catch(error){
    if(error?.code==='LOCAL_FILE_NOT_FOUND'){
      return reply.code(404).send({error:'Локальный файл не найден'});
    }

    return reply.code(500).send({
      error:`Не удалось удалить локальный файл: ${error.message}`
    });
  }
});

app.post('/api/webapp/local-files/:id/print',{preHandler:webAppAuth},async(req,reply)=>{
  const item=localFiles.find(file=>file.id===req.params.id);
  if(!item || !item.localPath || !fss.existsSync(item.localPath)) {
    return reply.code(404).send({error:'Локальный файл не найден'});
  }
  try{
    const buffer=await fs.readFile(item.localPath);
    const copies=normalizeCopies(req.body?.copies||1);
    const job=await createFileJob({
      buffer,
      filename:item.originalFilename||`${item.name}.pdf`,
      mimetype:item.mimetype||'application/pdf',
      profile:item.profile||'auto',
      title:`Локальный файл • ${item.name}`,
      source:'library',
      copies,
      telegram:{userId:req.telegramUser.id},
      meta:{libraryFileId:item.id,trigger:'webapp-library'}
    });
    return reply.code(201).send({job:publicJob(job)});
  }catch(e){
    return reply.code(422).send({error:e.message});
  }
});

app.post('/api/webapp/local-files/upload',{preHandler:webAppAuth},async(req,reply)=>{
  let buffer=null;
  let filename='label.pdf';
  let mimetype='application/pdf';
  let profile='auto';

  for await(const part of req.parts()){
    if(part.type==='file'){
      filename=part.filename||filename;
      mimetype=part.mimetype||mimetype;
      buffer=await part.toBuffer();
    }else if(part.fieldname==='profile'){
      profile=String(part.value||'auto');
    }
  }

  if(!buffer) return reply.code(400).send({error:'PDF не выбран'});
  if(!mimetype.includes('pdf')&&!filename.toLowerCase().endsWith('.pdf')){
    return reply.code(415).send({error:'Разрешены только PDF'});
  }

  try{
    const detection=await detectPdfSizeBuffer(buffer);
    let chosen=profile;

    if(!chosen||chosen==='auto') chosen=detection?.profile;

    if(!LABELS[chosen]){
      return reply.code(422).send({
        error:`Не удалось уверенно определить размер PDF (${detection?.widthMm||'?'}×${detection?.heightMm||'?'} мм). Выберите размер вручную перед сохранением.`
      });
    }

    const item=await saveToLocalLibrary({
      buffer,
      filename,
      mimetype,
      profile:chosen,
      detection,
      userId:req.telegramUser.id
    });

    return reply.code(201).send({file:publicLocalFile(item)});
  }catch(error){
    app.log.error({error:error?.message||String(error)},'save local PDF failed');
    return reply.code(422).send({error:error.message});
  }
});

app.post('/api/webapp/upload',{preHandler:webAppAuth},async(req,reply)=>{
  let buffer=null;
  let filename='label.pdf';
  let mimetype='application/pdf';
  let profile='auto';
  let copies=1;
  let saveLocal=false;

  for await(const part of req.parts()){
    if(part.type==='file'){
      filename=part.filename||filename;
      mimetype=part.mimetype||mimetype;
      buffer=await part.toBuffer();
    } else if(part.fieldname==='profile') {
      profile=String(part.value||'auto');
    } else if(part.fieldname==='copies') {
      copies=normalizeCopies(part.value);
    } else if(part.fieldname==='saveLocal') {
      saveLocal=['1','true','yes','on'].includes(String(part.value||'').toLowerCase());
    }
  }

  if(!buffer) return reply.code(400).send({error:'PDF не выбран'});
  if(!mimetype.includes('pdf') && !filename.toLowerCase().endsWith('.pdf')) {
    return reply.code(415).send({error:'В Web App разрешены только PDF'});
  }

  try{
    const job=await createFileJob({
      buffer,
      filename,
      mimetype,
      profile,
      copies,
      title:`Ручная печать • ${filename}`,
      source:'webapp',
      telegram:{userId:req.telegramUser.id}
    });

    let savedFile=null;
    if(saveLocal){
      savedFile=await saveToLocalLibrary({
        buffer,
        filename,
        mimetype,
        profile:job.profile,
        detection:job.detection,
        userId:req.telegramUser.id
      });
    }

    return reply.code(201).send({
      job:publicJob(job),
      savedFile:savedFile?publicLocalFile(savedFile):null
    });
  }catch(e){
    return reply.code(422).send({error:e.message});
  }
});
function recentActivePrintableJob(key){
  const cutoff=Date.now()-60000;
  return jobs.find(j=>j.meta?.printableKey===key && ['pending','sent','printing'].includes(j.status) && new Date(j.createdAt).getTime()>=cutoff);
}

app.post('/api/webapp/printables/:key/print',{preHandler:webAppAuth},async(req,reply)=>{
  const data=await refreshMarketplaceCache(true); const item=data.documents.find(d=>d.key===req.params.key);
  if(!item) return reply.code(404).send({error:'Документ уже недоступен. Возможно, отправление обработано/отгружено.'});
  const active=recentActivePrintableJob(item.key);
  if(active) return reply.code(409).send({error:`Этот файл уже отправлен на печать (#${active.id}).`});
  try{
    const buffer=await downloadMarketplacePrintable(item);
    const filename=`${item.marketplace}-${item.remoteId}-${item.size}.pdf`;
    const job=await createFileJob({buffer,filename,mimetype:'application/pdf',profile:item.size,title:item.title,source:'marketplace',marketplace:item.marketplace,telegram:{userId:req.telegramUser.id},meta:{printableKey:item.key,remoteId:item.remoteId}});
    return reply.code(201).send({job:publicJob(job)});
  }catch(e){ app.log.error(e); return reply.code(502).send({error:`Не удалось получить файл из ${item.marketplace}: ${e.message}`}); }
});

app.get('/agent/jobs/:id/file',async(req,reply)=>{
  if(req.query.token!==AGENT_TOKEN) return reply.code(401).send({error:'bad token'});
  const job=jobs.find(j=>j.id===req.params.id); if(!job?.localPath || !fss.existsSync(job.localPath)) return reply.code(404).send({error:'not found'});
  return reply.type(job.file?.mimetype||'application/octet-stream').send(fss.createReadStream(job.localPath));
});

const TG_PENDING=new Map();
const TG_SESSION=new Map();
const TG_COPIES=new Map();

const bot=new TelegramBot(TELEGRAM_BOT_TOKEN,{polling:TELEGRAM_MODE==='polling'});

function tgAllowed(x){
  return isAllowedId(x.from?.id||x.message?.chat?.id);
}

function tgSession(userId){
  return TG_SESSION.get(String(userId))||null;
}

function setTgSession(userId,value){
  if(value) TG_SESSION.set(String(userId),value);
  else TG_SESSION.delete(String(userId));
}

function tgCopyKey(userId,kind,id){
  return `${userId}:${kind}:${id}`;
}

function tgCopies(userId,kind,id){
  return TG_COPIES.get(tgCopyKey(userId,kind,id))||1;
}

function setTgCopies(userId,kind,id,value){
  const copies=normalizeCopies(value);
  TG_COPIES.set(tgCopyKey(userId,kind,id),copies);
  return copies;
}

function adjustTgCopies(userId,kind,id,delta){
  return setTgCopies(
    userId,
    kind,
    id,
    tgCopies(userId,kind,id)+Number(delta||0)
  );
}

function mainBotKeyboard(){
  return {
    inline_keyboard:[
      [
        {text:'🖨 Быстрая печать PDF',callback_data:'menu:quick'},
        {text:'📥 Загрузить PDF',callback_data:'menu:upload'}
      ],
      [
        {text:'📚 Локальные PDF',callback_data:'menu:library:0'},
        {text:'🏪 Маркетплейсы',callback_data:'menu:marketplaces:0'}
      ],
      [
        {text:'🕘 История',callback_data:'menu:history'},
        {text:'🟢 Агент и принтер',callback_data:'menu:status'}
      ],
      [
        {text:'🌐 Открыть WebApp',web_app:{url:WEBAPP_URL}}
      ]
    ]
  };
}

function backToMenuKeyboard(extraRows=[]){
  return {
    inline_keyboard:[
      ...extraRows,
      [{text:'‹ Главное меню',callback_data:'menu:main'}],
      [{text:'🌐 WebApp',web_app:{url:WEBAPP_URL}}]
    ]
  };
}

function botStatusText(){
  const agent=defaultAgentStatus();
  const meta=agent.meta||{};
  const active=jobs.filter(j=>['pending','sent','printing'].includes(j.status));

  return [
    '🖨 <b>PrintHub · Агент и принтер</b>',
    '',
    `Агент: ${agent.online?'🟢 в сети':'🔴 офлайн'}`,
    `ID: <code>${escapeTelegramHtml(agent.agentId)}</code>`,
    `Последняя связь: ${escapeTelegramHtml(agent.lastSeen||'—')}`,
    `CUPS: ${meta.cupsSchedulerRunning===true?'🟢 работает':meta.cupsSchedulerRunning===false?'🔴 недоступен':'⚪ нет данных'}`,
    `Очередь CUPS: ${meta.cupsQueueUsbExists===true?'🟢 готова':meta.cupsQueueUsbExists===false?'🔴 не найдена':'⚪ нет данных'}`,
    `Агент занят: ${meta.busy?'да':'нет'}`,
    `Внутренняя очередь: ${Number(meta.queuedJobs||0)}`,
    `Заданий PrintHub активно: ${active.length}`,
    `Транспорт: ${escapeTelegramHtml(meta.lastPrintTransport||'—')}`,
  ].join('\n');
}

function escapeTelegramHtml(value){
  return String(value??'')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;');
}

async function editOrSendBotMessage(q,text,reply_markup,options={}){
  const chatId=q.message?.chat?.id||q.from.id;
  const messageId=q.message?.message_id;

  if(messageId){
    try{
      return await bot.editMessageText(text,{
        chat_id:chatId,
        message_id:messageId,
        parse_mode:'HTML',
        disable_web_page_preview:true,
        reply_markup,
        ...options,
      });
    }catch(error){
      const message=String(error?.message||'');
      if(message.includes('message is not modified')) return;
    }
  }

  return bot.sendMessage(chatId,text,{
    parse_mode:'HTML',
    disable_web_page_preview:true,
    reply_markup,
    ...options,
  });
}

function formatLocalFileText(file){
  return [
    `${file.favorite?'⭐':'📄'} <b>${escapeTelegramHtml(file.name)}</b>`,
    '',
    `Размер этикетки: <b>${escapeTelegramHtml(String(file.profile||'auto').replace('x','×'))}</b>`,
    `PDF: ${Number(file.pageCount||1)} стр. · ${formatBytesBot(file.sizeBytes)}`,
    `Добавлен: ${escapeTelegramHtml(file.createdAt||'—')}`,
  ].join('\n');
}

function formatBytesBot(bytes){
  const n=Number(bytes||0);
  if(!Number.isFinite(n)||n<=0) return '—';
  if(n<1024*1024) return `${Math.max(1,Math.round(n/1024))} КБ`;
  return `${(n/1024/1024).toFixed(1)} МБ`;
}

function libraryItemKeyboard(userId,file,page=0,favoritesOnly=false){
  const copies=tgCopies(userId,'lib',file.id);
  const filter=favoritesOnly?'fav':'all';

  return {
    inline_keyboard:[
      [
        {text:'−',callback_data:`libcopy:${file.id}:-`},
        {text:`${copies} коп.`,callback_data:'noop'},
        {text:'+',callback_data:`libcopy:${file.id}:+`}
      ],
      [{text:`🖨 Печатать · ${copies} шт.`,callback_data:`libprint:${file.id}`}],
      [
        {text:'👁 Предпросмотр',callback_data:`libpreview:${file.id}`},
        {text:'✏️ Переименовать',callback_data:`librename:${file.id}`}
      ],
      [{text:file.favorite?'★ Убрать из избранного':'☆ В избранное',callback_data:`libfav:${file.id}`}],
      [{text:'🗑 Удалить локальный файл',callback_data:`libdeleteask:${file.id}:${page}:${filter}`}],
      [{text:'‹ К локальным PDF',callback_data:`menu:library:${page}:${filter}`}],
      [{text:'⌂ Главное меню',callback_data:'menu:main'}]
    ]
  };
}

function libraryDeleteConfirmKeyboard(file,page=0,favoritesOnly=false){
  const filter=favoritesOnly?'fav':'all';

  return {
    inline_keyboard:[
      [
        {text:'Отмена',callback_data:`libdeletecancel:${file.id}:${page}:${filter}`},
        {text:'🗑 Удалить',callback_data:`libdeleteconfirm:${file.id}:${page}:${filter}`}
      ],
      [{text:'⌂ Главное меню',callback_data:'menu:main'}]
    ]
  };
}

function pendingPrintKeyboard(userId,pending){
  const copies=tgCopies(userId,'pending',pending.id);
  const label=pending.profile&&LABELS[pending.profile]
    ? LABELS[pending.profile].name
    : 'не выбран';

  const rows=[
    [
      {text:'−',callback_data:`pencopy:${pending.id}:-`},
      {text:`${copies} коп.`,callback_data:'noop'},
      {text:'+',callback_data:`pencopy:${pending.id}:+`}
    ],
    [{text:`📐 ${label}`,callback_data:'noop'}],
  ];

  if(!pending.profile){
    rows.push([
      {text:'58×40',callback_data:`penprofile:${pending.id}:58x40`},
      {text:'58×60',callback_data:`penprofile:${pending.id}:58x60`},
      {text:'75×120',callback_data:`penprofile:${pending.id}:75x120`}
    ]);
  }

  rows.push([{text:`🖨 Печатать · ${copies} шт.`,callback_data:`penprint:${pending.id}`}]);
  rows.push([{text:'Отменить',callback_data:`pencancel:${pending.id}`}]);

  return {inline_keyboard:rows};
}

function pendingSaveKeyboard(pending){
  return {
    inline_keyboard:[
      [
        {text:'58×40',callback_data:`pensave:${pending.id}:58x40`},
        {text:'58×60',callback_data:`pensave:${pending.id}:58x60`},
        {text:'75×120',callback_data:`pensave:${pending.id}:75x120`}
      ],
      [{text:'Отменить',callback_data:`pencancel:${pending.id}`}]
    ]
  };
}

async function showMainMenu(chatId,text='PrintHub'){
  setTgSession(chatId,null);
  return bot.sendMessage(
    chatId,
    `<b>${escapeTelegramHtml(text)}</b>\n\nВыберите действие. Все основные функции доступны прямо в боте; WebApp остаётся расширенным визуальным интерфейсом.`,
    {parse_mode:'HTML',reply_markup:mainBotKeyboard()}
  );
}

async function showLibrary(q,pageRaw=0,favoritesOnly=false){
  const page=Math.max(0,Math.trunc(Number(pageRaw||0)));
  const pageSize=7;
  const allAvailable=localFiles
    .filter(file=>file.localPath&&fss.existsSync(file.localPath))
    .slice()
    .sort((a,b)=>{
      const favoriteDelta=Number(Boolean(b.favorite))-Number(Boolean(a.favorite));
      if(favoriteDelta) return favoriteDelta;
      return String(b.createdAt||'').localeCompare(String(a.createdAt||''));
    });
  const available=favoritesOnly?allAvailable.filter(file=>file.favorite):allAvailable;
  const totalPages=Math.max(1,Math.ceil(available.length/pageSize));
  const safePage=Math.min(page,totalPages-1);
  const slice=available.slice(safePage*pageSize,(safePage+1)*pageSize);

  const rows=slice.map(file=>[
    {
      text:`${file.favorite?'⭐':'📄'} ${String(file.name||'PDF').slice(0,36)}`,
      callback_data:`libopen:${file.id}:${safePage}:${favoritesOnly?'fav':'all'}`
    }
  ]);

  if(totalPages>1){
    rows.push([
      {
        text:'‹',
        callback_data:`menu:library:${Math.max(0,safePage-1)}:${favoritesOnly?'fav':'all'}`
      },
      {
        text:`${safePage+1}/${totalPages}`,
        callback_data:'noop'
      },
      {
        text:'›',
        callback_data:`menu:library:${Math.min(totalPages-1,safePage+1)}:${favoritesOnly?'fav':'all'}`
      }
    ]);
  }

  rows.push([
    {text:favoritesOnly?'📚 Все PDF':`⭐ Избранное (${allAvailable.filter(file=>file.favorite).length})`,callback_data:`menu:library:0:${favoritesOnly?'all':'fav'}`},
    {text:'🔎 Поиск',callback_data:'menu:librarysearch'}
  ]);
  rows.push([{text:'📥 Загрузить новый PDF',callback_data:'menu:upload'}]);
  rows.push([{text:'‹ Главное меню',callback_data:'menu:main'}]);

  const text=[
    '📚 <b>Локальные PDF</b>',
    '',
    available.length
      ? `${favoritesOnly?'Избранных':'Сохранено файлов'}: <b>${available.length}</b>. Выберите PDF для предпросмотра, переименования или печати.`
      : favoritesOnly?'В избранном пока нет PDF.':'Локальное хранилище пока пусто.',
  ].join('\n');

  return editOrSendBotMessage(q,text,{inline_keyboard:rows});
}

async function showLocalFile(q,id,page=0,favoritesOnly=false){
  const file=localFiles.find(item=>item.id===id&&item.localPath&&fss.existsSync(item.localPath));
  if(!file){
    return bot.answerCallbackQuery(q.id,{text:'Файл не найден',show_alert:true});
  }

  setTgCopies(q.from.id,'lib',file.id,tgCopies(q.from.id,'lib',file.id));
  await bot.answerCallbackQuery(q.id).catch(()=>{});
  return editOrSendBotMessage(
    q,
    formatLocalFileText(publicLocalFile(file)),
    libraryItemKeyboard(q.from.id,file,page,favoritesOnly)
  );
}

async function showMarketplaces(q,pageRaw=0){
  const page=Math.max(0,Math.trunc(Number(pageRaw||0)));
  const data=await refreshMarketplaceCache(true);
  const pageSize=7;
  const totalPages=Math.max(1,Math.ceil(data.documents.length/pageSize));
  const safePage=Math.min(page,totalPages-1);
  const slice=data.documents.slice(safePage*pageSize,(safePage+1)*pageSize);

  const rows=slice.map(item=>[
    {
      text:`${item.marketplace==='ozon'?'Ozon':item.marketplace==='wb'?'WB':'Яндекс'} · ${String(item.title||'Файл').slice(0,34)}`,
      callback_data:`mpopen:${printableToken(item.key)}:${safePage}`
    }
  ]);

  if(totalPages>1){
    rows.push([
      {text:'‹',callback_data:`menu:marketplaces:${Math.max(0,safePage-1)}`},
      {text:`${safePage+1}/${totalPages}`,callback_data:'noop'},
      {text:'›',callback_data:`menu:marketplaces:${Math.min(totalPages-1,safePage+1)}`}
    ]);
  }

  rows.push([{text:'↻ Обновить',callback_data:`menu:marketplaces:${safePage}`}]);
  rows.push([{text:'‹ Главное меню',callback_data:'menu:main'}]);

  const errorText=(data.errors||[]).length
    ? `\n\n⚠️ ${data.errors.map(e=>`${e.marketplace}: ${e.error}`).join('\n')}`
    : '';

  return editOrSendBotMessage(
    q,
    `🏪 <b>Файлы маркетплейсов</b>\n\nДоступно: <b>${data.documents.length}</b>${escapeTelegramHtml(errorText)}`,
    {inline_keyboard:rows}
  );
}

async function showMarketplaceItem(q,token,page=0){
  const data=await refreshMarketplaceCache(true);
  const item=data.documents.find(d=>printableToken(d.key)===token);

  if(!item){
    return bot.answerCallbackQuery(q.id,{
      text:'Файл уже недоступен. Возможно, отправление обработано.',
      show_alert:true
    });
  }

  const copies=tgCopies(q.from.id,'mp',token);
  const mp=item.marketplace==='ozon'?'Ozon':item.marketplace==='wb'?'Wildberries':'Яндекс Маркет';

  await bot.answerCallbackQuery(q.id).catch(()=>{});

  return editOrSendBotMessage(
    q,
    [
      `🏪 <b>${mp}</b>`,
      '',
      `<b>${escapeTelegramHtml(item.title)}</b>`,
      item.subtitle?escapeTelegramHtml(item.subtitle):'',
      `Размер: <b>${escapeTelegramHtml(String(item.size||'auto').replace('x','×'))}</b>`,
    ].filter(Boolean).join('\n'),
    {
      inline_keyboard:[
        [
          {text:'−',callback_data:`mpcopy:${token}:-`},
          {text:`${copies} коп.`,callback_data:'noop'},
          {text:'+',callback_data:`mpcopy:${token}:+`}
        ],
        [{text:`🖨 Печатать · ${copies} шт.`,callback_data:`mpprint2:${token}`}],
        [{text:'‹ К маркетплейсам',callback_data:`menu:marketplaces:${page}`}],
        [{text:'⌂ Главное меню',callback_data:'menu:main'}]
      ]
    }
  );
}

async function showHistory(q){
  const recent=jobs
    .slice()
    .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0,12);

  const statusIcon=status=>({
    pending:'⏳',
    sent:'📤',
    printing:'🖨',
    done:'✅',
    failed:'❌',
  })[status]||'•';

  const lines=recent.map(job=>{
    const title=String(job.title||job.file?.filename||job.id).replace(/\s+/g,' ').slice(0,70);
    const error=job.status==='failed'&&job.error
      ? `\n   ↳ ${String(job.error).replace(/\s+/g,' ').slice(0,100)}`
      : '';
    return `${statusIcon(job.status)} <b>${escapeTelegramHtml(title)}</b>\n   ${escapeTelegramHtml(String(job.profile||'—').replace('x','×'))} · ${job.copies||1} шт.${escapeTelegramHtml(error)}`;
  });

  await bot.answerCallbackQuery(q.id).catch(()=>{});
  return editOrSendBotMessage(
    q,
    `🕘 <b>История печати</b>\n\n${lines.length?lines.join('\n\n'):'История пока пуста.'}`,
    backToMenuKeyboard([[{text:'↻ Обновить',callback_data:'menu:history'}]])
  );
}

async function downloadTelegramPdf(document){
  const filename=document.file_name||'label.pdf';
  const mimetype=document.mime_type||'application/pdf';

  if(!mimetype.includes('pdf')&&!filename.toLowerCase().endsWith('.pdf')){
    throw new Error('Поддерживаются только PDF-файлы.');
  }

  const link=await bot.getFileLink(document.file_id);
  const response=await fetch(link);
  if(!response.ok) throw new Error(`Telegram download ${response.status}`);

  return {
    filename,
    mimetype,
    buffer:Buffer.from(await response.arrayBuffer())
  };
}

async function createPendingTelegramPdf(msg,action){
  const {filename,mimetype,buffer}=await downloadTelegramPdf(msg.document);
  const detection=await detectPdfSizeBuffer(buffer);
  const id=nanoid(8);
  const localPath=await saveUploadedBuffer(buffer,filename);

  const pending={
    id,
    action,
    localPath,
    filename,
    mimetype,
    detection,
    profile:detection?.profile||null,
    createdAt:Date.now(),
    userId:msg.from.id,
    chatId:msg.chat.id
  };

  TG_PENDING.set(id,pending);
  setTgCopies(msg.from.id,'pending',id,1);
  return pending;
}

async function cleanupPending(id){
  const pending=TG_PENDING.get(id);
  if(pending?.localPath) await fs.rm(pending.localPath,{force:true}).catch(()=>{});
  TG_PENDING.delete(id);
}

async function savePendingToLibrary(pending,profile){
  const buffer=await fs.readFile(pending.localPath);
  const detection=pending.detection||await detectPdfSizeBuffer(buffer);
  const chosen=profile||pending.profile||detection?.profile;

  if(!LABELS[chosen]){
    throw new Error('Выберите размер этикетки.');
  }

  return saveToLocalLibrary({
    buffer,
    filename:pending.filename,
    mimetype:pending.mimetype,
    profile:chosen,
    detection,
    userId:pending.userId
  });
}

async function printPendingTelegram(pending,copies){
  const buffer=await fs.readFile(pending.localPath);
  const chosen=pending.profile||pending.detection?.profile;

  if(!LABELS[chosen]) throw new Error('Выберите размер этикетки.');

  return createFileJob({
    buffer,
    filename:pending.filename,
    mimetype:pending.mimetype,
    profile:chosen,
    copies,
    title:`Telegram • ${pending.filename}`,
    source:'telegram',
    telegram:{chatId:pending.chatId,userId:pending.userId},
    meta:{trigger:'telegram-menu'}
  });
}

bot.onText(/\/start|\/menu/,async msg=>{
  if(!tgAllowed(msg)) return bot.sendMessage(msg.chat.id,'Доступ запрещен.');
  return showMainMenu(msg.chat.id,'PrintHub');
});

bot.onText(/\/cancel/,async msg=>{
  if(!tgAllowed(msg)) return;
  setTgSession(msg.from.id,null);
  await bot.sendMessage(msg.chat.id,'Текущее действие отменено.');
  return showMainMenu(msg.chat.id,'PrintHub');
});

bot.on('callback_query',async q=>{
  if(!tgAllowed(q)){
    return bot.answerCallbackQuery(q.id,{text:'Доступ запрещен',show_alert:true});
  }

  const data=String(q.data||'');
  const chatId=q.message?.chat?.id||q.from.id;
  const userId=q.from.id;

  try{
    if(data==='noop'){
      return bot.answerCallbackQuery(q.id);
    }

    if(data==='menu:main'){
      setTgSession(userId,null);
      await bot.answerCallbackQuery(q.id).catch(()=>{});
      return editOrSendBotMessage(
        q,
        '<b>PrintHub</b>\n\nВыберите действие.',
        mainBotKeyboard()
      );
    }

    if(data==='menu:quick'){
      setTgSession(userId,{mode:'quick_print'});
      await bot.answerCallbackQuery(q.id).catch(()=>{});
      return bot.sendMessage(
        chatId,
        '🖨 <b>Быстрая печать</b>\n\nОтправьте PDF следующим сообщением. После загрузки можно выбрать размер и количество копий кнопками −/+.\n\n/cancel — отменить.',
        {parse_mode:'HTML'}
      );
    }

    if(data==='menu:upload'){
      setTgSession(userId,{mode:'save_local'});
      await bot.answerCallbackQuery(q.id).catch(()=>{});
      return bot.sendMessage(
        chatId,
        '📥 <b>Загрузить PDF в локальные</b>\n\nОтправьте PDF следующим сообщением. Файл будет сохранён в локальную библиотеку <b>без печати</b>.\n\n/cancel — отменить.',
        {parse_mode:'HTML'}
      );
    }

    if(data.startsWith('menu:library:')){
      const parts=data.split(':');
      await bot.answerCallbackQuery(q.id).catch(()=>{});
      return showLibrary(q,parts[2]||0,parts[3]==='fav');
    }

    if(data==='menu:librarysearch'){
      setTgSession(userId,{mode:'search_local'});
      await bot.answerCallbackQuery(q.id).catch(()=>{});
      return bot.sendMessage(
        chatId,
        `🔎 <b>Поиск по локальным PDF</b>

Отправьте часть названия файла. /cancel — отменить.`,
        {parse_mode:'HTML'}
      );
    }

    if(data.startsWith('menu:marketplaces:')){
      await bot.answerCallbackQuery(q.id).catch(()=>{});
      return showMarketplaces(q,data.split(':')[2]||0);
    }

    if(data==='menu:history'){
      return showHistory(q);
    }

    if(data==='menu:status'||data==='status'){
      await bot.answerCallbackQuery(q.id).catch(()=>{});
      return editOrSendBotMessage(
        q,
        botStatusText(),
        backToMenuKeyboard([[{text:'↻ Обновить',callback_data:'menu:status'}]])
      );
    }

    if(data.startsWith('libopen:')){
      const [,id,page='0',filter='all']=data.split(':');
      return showLocalFile(q,id,page,filter==='fav');
    }

    if(data.startsWith('libcopy:')){
      const [,id,direction]=data.split(':');
      const file=localFiles.find(item=>item.id===id);
      if(!file) return bot.answerCallbackQuery(q.id,{text:'Файл не найден',show_alert:true});

      adjustTgCopies(userId,'lib',id,direction==='+'?1:-1);
      await bot.answerCallbackQuery(q.id).catch(()=>{});
      return bot.editMessageReplyMarkup(
        libraryItemKeyboard(userId,file,0),
        {chat_id:chatId,message_id:q.message.message_id}
      );
    }

    if(data.startsWith('libfav:')){
      const id=data.split(':')[1];
      const file=localFiles.find(item=>item.id===id);
      if(!file) return bot.answerCallbackQuery(q.id,{text:'Файл не найден',show_alert:true});

      file.favorite=!Boolean(file.favorite);
      file.updatedAt=now();
      await saveLocalFiles();
      await bot.answerCallbackQuery(q.id,{text:file.favorite?'Добавлено в избранное':'Удалено из избранного'}).catch(()=>{});

      return bot.editMessageReplyMarkup(
        libraryItemKeyboard(userId,file,0,false),
        {chat_id:chatId,message_id:q.message.message_id}
      );
    }

    if(data.startsWith('libdeleteask:')){
      const [,id,page='0',filter='all']=data.split(':');
      const file=localFiles.find(item=>item.id===id&&item.localPath&&fss.existsSync(item.localPath));

      if(!file){
        return bot.answerCallbackQuery(q.id,{
          text:'Файл не найден',
          show_alert:true
        });
      }

      await bot.answerCallbackQuery(q.id).catch(()=>{});

      return editOrSendBotMessage(
        q,
        [
          '🗑 <b>Удалить локальный PDF?</b>',
          '',
          `<b>${escapeTelegramHtml(file.name)}</b>`,
          `${escapeTelegramHtml(String(file.profile||'auto').replace('x','×'))} · ${formatBytesBot(file.sizeBytes)}`,
          '',
          'Файл будет удалён из локального хранилища.',
          'История уже выполненной печати останется.'
        ].join('\n'),
        libraryDeleteConfirmKeyboard(file,page,filter==='fav')
      );
    }

    if(data.startsWith('libdeletecancel:')){
      const [,id,page='0',filter='all']=data.split(':');
      return showLocalFile(q,id,page,filter==='fav');
    }

    if(data.startsWith('libdeleteconfirm:')){
      const [,id,page='0',filter='all']=data.split(':');
      const file=localFiles.find(item=>item.id===id);

      if(!file){
        await bot.answerCallbackQuery(q.id,{
          text:'Файл уже удалён',
          show_alert:false
        }).catch(()=>{});

        return showLibrary(q,page,filter==='fav');
      }

      const fileName=file.name;

      await bot.answerCallbackQuery(q.id,{
        text:'Удаляю локальный PDF…'
      }).catch(()=>{});

      try{
        await deleteLocalLibraryFile(id);

        return editOrSendBotMessage(
          q,
          [
            '✅ <b>Локальный PDF удалён</b>',
            '',
            escapeTelegramHtml(fileName),
            '',
            'История уже выполненной печати сохранена.'
          ].join('\n'),
          {
            inline_keyboard:[
              [{text:'‹ К локальным PDF',callback_data:`menu:library:${page}:${filter}`}],
              [{text:'⌂ Главное меню',callback_data:'menu:main'}]
            ]
          }
        );
      }catch(error){
        app.log.error({
          fileId:id,
          error:error?.message||String(error)
        },'telegram local PDF delete failed');

        return bot.sendMessage(
          chatId,
          `❌ Не удалось удалить локальный PDF: ${error.message}`,
          {reply_markup:mainBotKeyboard()}
        );
      }
    }

    if(data.startsWith('libprint:')){
      const id=data.split(':')[1];
      const file=localFiles.find(item=>item.id===id&&item.localPath&&fss.existsSync(item.localPath));
      if(!file) return bot.answerCallbackQuery(q.id,{text:'Файл не найден',show_alert:true});

      const copies=tgCopies(userId,'lib',id);
      await bot.answerCallbackQuery(q.id,{text:'Отправляю на печать…'});

      const buffer=await fs.readFile(file.localPath);
      const job=await createFileJob({
        buffer,
        filename:file.originalFilename||`${file.name}.pdf`,
        mimetype:file.mimetype||'application/pdf',
        profile:file.profile||'auto',
        title:`Локальный файл • ${file.name}`,
        source:'library',
        copies,
        telegram:{chatId,userId},
        meta:{libraryFileId:file.id,trigger:'telegram-library'}
      });

      return bot.sendMessage(
        chatId,
        `✅ Отправлено на печать #${job.id} · ${LABELS[job.profile]?.name||job.profile} · ${job.copies} шт.`,
        {reply_markup:mainBotKeyboard()}
      );
    }

    if(data.startsWith('libpreview:')){
      const id=data.split(':')[1];
      const file=localFiles.find(item=>item.id===id&&item.localPath&&fss.existsSync(item.localPath));
      if(!file) return bot.answerCallbackQuery(q.id,{text:'Файл не найден',show_alert:true});

      await bot.answerCallbackQuery(q.id,{text:'Готовлю предпросмотр…'});
      const previewPath=await renderLibraryPreview(file,1,'full');

      return bot.sendPhoto(
        chatId,
        previewPath,
        {
          caption:`${file.name}\n${String(file.profile||'auto').replace('x','×')} · ${file.pageCount||1} стр.`,
          reply_markup:libraryItemKeyboard(userId,file,0)
        }
      );
    }

    if(data.startsWith('librename:')){
      const id=data.split(':')[1];
      const file=localFiles.find(item=>item.id===id);
      if(!file) return bot.answerCallbackQuery(q.id,{text:'Файл не найден',show_alert:true});

      setTgSession(userId,{mode:'rename_local',fileId:id});
      await bot.answerCallbackQuery(q.id).catch(()=>{});
      return bot.sendMessage(
        chatId,
        `✏️ Отправьте новое имя для файла:\n<b>${escapeTelegramHtml(file.name)}</b>\n\n/cancel — отменить.`,
        {parse_mode:'HTML'}
      );
    }

    if(data.startsWith('mpopen:')){
      const [,token,page='0']=data.split(':');
      return showMarketplaceItem(q,token,page);
    }

    if(data.startsWith('mpcopy:')){
      const [,token,direction]=data.split(':');
      const copies=adjustTgCopies(userId,'mp',token,direction==='+'?1:-1);
      await bot.answerCallbackQuery(q.id).catch(()=>{});

      const markup=q.message?.reply_markup?.inline_keyboard||[];
      const next=JSON.parse(JSON.stringify(markup));
      if(next[0]){
        next[0]=[
          {text:'−',callback_data:`mpcopy:${token}:-`},
          {text:`${copies} коп.`,callback_data:'noop'},
          {text:'+',callback_data:`mpcopy:${token}:+`}
        ];
      }
      if(next[1]){
        next[1]=[{text:`🖨 Печатать · ${copies} шт.`,callback_data:`mpprint2:${token}`}];
      }

      return bot.editMessageReplyMarkup(
        {inline_keyboard:next},
        {chat_id:chatId,message_id:q.message.message_id}
      );
    }

    if(data.startsWith('mpprint2:')||data.startsWith('mpprint:')){
      const token=data.split(':')[1];
      const mpData=await refreshMarketplaceCache(true);
      const item=mpData.documents.find(d=>printableToken(d.key)===token);

      if(!item){
        return bot.answerCallbackQuery(q.id,{
          text:'Файл уже недоступен. Возможно, отправление обработано.',
          show_alert:true
        });
      }

      const active=recentActivePrintableJob(item.key);
      if(active){
        return bot.answerCallbackQuery(q.id,{
          text:`Уже в очереди #${active.id}`,
          show_alert:true
        });
      }

      const copies=data.startsWith('mpprint2:')
        ? tgCopies(userId,'mp',token)
        : 1;

      await bot.answerCallbackQuery(q.id,{text:'Получаю файл…'});
      const buffer=await downloadMarketplacePrintable(item);
      const filename=`${item.marketplace}-${item.remoteId}-${item.size}.pdf`;

      const job=await createFileJob({
        buffer,
        filename,
        mimetype:'application/pdf',
        profile:item.size,
        copies,
        title:item.title,
        source:'marketplace',
        marketplace:item.marketplace,
        telegram:{chatId,userId},
        meta:{
          printableKey:item.key,
          remoteId:item.remoteId,
          trigger:'telegram-button'
        }
      });

      return bot.sendMessage(
        chatId,
        `✅ Отправлено на печать #${job.id} · ${LABELS[job.profile]?.name||job.profile} · ${job.copies} шт.`,
        {reply_markup:mainBotKeyboard()}
      );
    }

    if(data.startsWith('pencopy:')){
      const [,id,direction]=data.split(':');
      const pending=TG_PENDING.get(id);
      if(!pending) return bot.answerCallbackQuery(q.id,{text:'Файл устарел',show_alert:true});

      adjustTgCopies(userId,'pending',id,direction==='+'?1:-1);
      await bot.answerCallbackQuery(q.id).catch(()=>{});
      return bot.editMessageReplyMarkup(
        pendingPrintKeyboard(userId,pending),
        {chat_id:chatId,message_id:q.message.message_id}
      );
    }

    if(data.startsWith('penprofile:')){
      const [,id,profile]=data.split(':');
      const pending=TG_PENDING.get(id);
      if(!pending) return bot.answerCallbackQuery(q.id,{text:'Файл устарел',show_alert:true});
      if(!LABELS[profile]) return bot.answerCallbackQuery(q.id,{text:'Некорректный размер',show_alert:true});

      pending.profile=profile;
      await bot.answerCallbackQuery(q.id,{text:`Размер ${LABELS[profile].name}`});
      return bot.editMessageReplyMarkup(
        pendingPrintKeyboard(userId,pending),
        {chat_id:chatId,message_id:q.message.message_id}
      );
    }

    if(data.startsWith('penprint:')){
      const id=data.split(':')[1];
      const pending=TG_PENDING.get(id);
      if(!pending) return bot.answerCallbackQuery(q.id,{text:'Файл устарел',show_alert:true});
      if(!pending.profile) return bot.answerCallbackQuery(q.id,{text:'Сначала выберите размер',show_alert:true});

      const copies=tgCopies(userId,'pending',id);
      await bot.answerCallbackQuery(q.id,{text:'Отправляю…'});
      const job=await printPendingTelegram(pending,copies);
      await cleanupPending(id);
      setTgSession(userId,null);

      return bot.sendMessage(
        chatId,
        `✅ Отправлено на печать #${job.id} · ${LABELS[job.profile]?.name||job.profile} · ${job.copies} шт.`,
        {reply_markup:mainBotKeyboard()}
      );
    }

    if(data.startsWith('pensave:')){
      const [,id,profile]=data.split(':');
      const pending=TG_PENDING.get(id);
      if(!pending) return bot.answerCallbackQuery(q.id,{text:'Файл устарел',show_alert:true});

      await bot.answerCallbackQuery(q.id,{text:'Сохраняю…'});
      const file=await savePendingToLibrary(pending,profile);
      await cleanupPending(id);
      setTgSession(userId,null);

      return bot.sendMessage(
        chatId,
        `✅ PDF сохранён в локальные без печати.\n\n${file.name}\n${String(file.profile).replace('x','×')} · ${file.pageCount} стр.`,
        {reply_markup:mainBotKeyboard()}
      );
    }

    if(data.startsWith('pencancel:')||data.startsWith('cancel:')){
      const id=data.split(':')[1];
      await cleanupPending(id);
      setTgSession(userId,null);
      await bot.answerCallbackQuery(q.id,{text:'Отменено'});
      return bot.sendMessage(chatId,'Действие отменено.',{reply_markup:mainBotKeyboard()});
    }

    // Backward compatibility with old force buttons.
    if(data.startsWith('force:')){
      const [,id,profile]=data.split(':');
      const pending=TG_PENDING.get(id);
      if(!pending) return bot.answerCallbackQuery(q.id,{text:'Файл устарел',show_alert:true});

      pending.profile=profile;
      const job=await printPendingTelegram(pending,1);
      await cleanupPending(id);
      await bot.answerCallbackQuery(q.id,{text:'Отправлено'});

      return bot.sendMessage(
        chatId,
        `✅ Отправлено на печать #${job.id} (${LABELS[profile].name})`,
        {reply_markup:mainBotKeyboard()}
      );
    }

    return bot.answerCallbackQuery(q.id,{text:'Команда устарела. Откройте /menu.'});
  }catch(error){
    app.log.error({error:error?.message||String(error),callback:data},'telegram callback failed');
    await bot.answerCallbackQuery(q.id,{text:'Ошибка',show_alert:false}).catch(()=>{});
    return bot.sendMessage(
      chatId,
      `❌ ${error.message}`,
      {reply_markup:mainBotKeyboard()}
    ).catch(()=>{});
  }
});

async function processTelegramPdf(msg){
  const session=tgSession(msg.from.id);

  if(session?.mode==='save_local'){
    const pending=await createPendingTelegramPdf(msg,'save_local');
    setTgSession(msg.from.id,null);

    if(pending.profile){
      const file=await savePendingToLibrary(pending,pending.profile);
      await cleanupPending(pending.id);

      return bot.sendMessage(
        msg.chat.id,
        `✅ PDF сохранён в локальные <b>без печати</b>.\n\n${escapeTelegramHtml(file.name)}\n${escapeTelegramHtml(String(file.profile).replace('x','×'))} · ${file.pageCount} стр.`,
        {parse_mode:'HTML',reply_markup:mainBotKeyboard()}
      );
    }

    return bot.sendMessage(
      msg.chat.id,
      `📐 Не удалось уверенно определить размер PDF (${pending.detection?.widthMm||'?'}×${pending.detection?.heightMm||'?'} мм).\n\nВыберите размер, под которым сохранить файл:`,
      {reply_markup:pendingSaveKeyboard(pending)}
    );
  }

  if(session?.mode==='quick_print'){
    const pending=await createPendingTelegramPdf(msg,'quick_print');
    setTgSession(msg.from.id,null);

    return bot.sendMessage(
      msg.chat.id,
      [
        '🖨 <b>PDF готов к печати</b>',
        '',
        `<b>${escapeTelegramHtml(pending.filename)}</b>`,
        pending.profile
          ? `Размер определён: <b>${LABELS[pending.profile].name}</b>`
          : `Размер не определён уверенно: ${pending.detection?.widthMm||'?'}×${pending.detection?.heightMm||'?'} мм`,
        'Выберите количество копий кнопками −/+.',
      ].join('\n'),
      {
        parse_mode:'HTML',
        reply_markup:pendingPrintKeyboard(msg.from.id,pending)
      }
    );
  }

  // Backward compatible behavior: a PDF sent without selecting a menu action
  // is treated as one-copy quick print.
  const {filename,mimetype,buffer}=await downloadTelegramPdf(msg.document);

  try{
    const job=await createFileJob({
      buffer,
      filename,
      mimetype,
      profile:'auto',
      source:'telegram',
      copies:1,
      telegram:{chatId:msg.chat.id,userId:msg.from.id},
      meta:{trigger:'telegram-direct'}
    });

    return bot.sendMessage(
      msg.chat.id,
      `✅ Отправлено на печать #${job.id} · ${LABELS[job.profile].name} · 1 шт.`,
      {reply_markup:mainBotKeyboard()}
    );
  }catch(error){
    const detection=await detectPdfSizeBuffer(buffer).catch(()=>null);
    const id=nanoid(8);
    const localPath=await saveUploadedBuffer(buffer,filename);
    const pending={
      id,
      action:'quick_print',
      localPath,
      filename,
      mimetype,
      detection,
      profile:detection?.profile||null,
      createdAt:Date.now(),
      userId:msg.from.id,
      chatId:msg.chat.id
    };
    TG_PENDING.set(id,pending);
    setTgCopies(msg.from.id,'pending',id,1);

    return bot.sendMessage(
      msg.chat.id,
      `${error.message}\n\nВыберите размер и количество копий:`,
      {reply_markup:pendingPrintKeyboard(msg.from.id,pending)}
    );
  }
}

bot.on('document',async msg=>{
  if(!tgAllowed(msg)) return bot.sendMessage(msg.chat.id,'Доступ запрещен.');

  try{
    await processTelegramPdf(msg);
  }catch(error){
    app.log.error(error);
    await bot.sendMessage(
      msg.chat.id,
      `❌ Ошибка: ${error.message}`,
      {reply_markup:mainBotKeyboard()}
    );
  }
});

bot.on('message',async msg=>{
  if(!tgAllowed(msg)) return;
  if(msg.document) return;
  if(!msg.text||msg.text.startsWith('/')) return;

  const session=tgSession(msg.from.id);

  if(session?.mode==='search_local'){
    const query=String(msg.text||'').trim().toLocaleLowerCase('ru-RU');
    setTgSession(msg.from.id,null);

    const matches=localFiles
      .filter(item=>item.localPath&&fss.existsSync(item.localPath))
      .filter(item=>String(item.name||'').toLocaleLowerCase('ru-RU').includes(query))
      .sort((a,b)=>Number(Boolean(b.favorite))-Number(Boolean(a.favorite)))
      .slice(0,12);

    const rows=matches.map(file=>[{
      text:`${file.favorite?'⭐':'📄'} ${String(file.name||'PDF').slice(0,36)}`,
      callback_data:`libopen:${file.id}:0:all`
    }]);
    rows.push([{text:'‹ К локальным PDF',callback_data:'menu:library:0:all'}]);

    return bot.sendMessage(
      msg.chat.id,
      matches.length
        ? `🔎 Найдено: <b>${matches.length}</b> по запросу «${escapeTelegramHtml(msg.text)}»`
        : `Ничего не найдено по запросу «${escapeTelegramHtml(msg.text)}».`,
      {parse_mode:'HTML',reply_markup:{inline_keyboard:rows}}
    );
  }

  if(session?.mode!=='rename_local') return;

  const file=localFiles.find(item=>item.id===session.fileId);
  if(!file){
    setTgSession(msg.from.id,null);
    return bot.sendMessage(msg.chat.id,'Файл больше не найден.',{reply_markup:mainBotKeyboard()});
  }

  file.name=normalizeLibraryName(msg.text,file.name);
  file.updatedAt=now();
  await saveLocalFiles();
  setTgSession(msg.from.id,null);

  return bot.sendMessage(
    msg.chat.id,
    `✅ Файл переименован:\n<b>${escapeTelegramHtml(file.name)}</b>`,
    {parse_mode:'HTML',reply_markup:mainBotKeyboard()}
  );
});

if(TELEGRAM_MODE==='webhook'){
  app.post(TELEGRAM_WEBHOOK_PATH,async(req,reply)=>{if(TELEGRAM_WEBHOOK_SECRET&&req.headers['x-telegram-bot-api-secret-token']!==TELEGRAM_WEBHOOK_SECRET)return reply.code(401).send({ok:false});bot.processUpdate(req.body);return {ok:true};});
}

const server=await app.listen({port:PORT,host:'0.0.0.0'});

// WebSocket авторизуется ДО отправки HTTP 101.
// Это исключает ложный сценарий "connected -> immediately disconnected"
// и позволяет агенту увидеть HTTP 401/404 как настоящую причину.
const wss=new WebSocketServer({noServer:true});

app.server.on('upgrade',(req,socket,head)=>{
  let url;
  try{
    url=new URL(req.url||'/',PUBLIC_URL);
  }catch(error){
    app.log.warn({error:error.message,url:req.url},'websocket bad URL');
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  if(url.pathname!=='/ws/agent'){
    app.log.warn({path:url.pathname},'websocket unknown path');
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  const queryToken=url.searchParams.get('token')||'';
  const authHeader=String(req.headers.authorization||'');
  const bearerToken=authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const suppliedToken=bearerToken||queryToken;
  const agentId=url.searchParams.get('agentId')||DEFAULT_AGENT_ID;

  if(!safeTokenEqual(suppliedToken,AGENT_TOKEN)){
    app.log.warn({
      agentId,
      remoteAddress:req.socket?.remoteAddress,
      hasBearer:Boolean(bearerToken),
      hasQueryToken:Boolean(queryToken)
    },'agent websocket unauthorized');
    socket.write(
      'HTTP/1.1 401 Unauthorized\r\n'+
      'Connection: close\r\n'+
      'Content-Type: text/plain\r\n'+
      'Content-Length: 12\r\n\r\nUnauthorized'
    );
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req,socket,head,ws=>{
    ws.agentId=agentId;
    ws.isAlive=true;
    wss.emit('connection',ws,req);
  });
});

wss.on('connection',(ws,req)=>{
  const agentId=ws.agentId||DEFAULT_AGENT_ID;
  const connectedAt=now();
  const connectionId=crypto.randomBytes(5).toString('hex');

  agents.set(agentId,{
    ws,
    connectionId,
    connectedAt,
    lastSeen:connectedAt,
    meta:null
  });

  app.log.info({
    agentId,
    connectionId,
    remoteAddress:req.socket?.remoteAddress
  },'agent connected');

  ws.on('pong',()=>{
    ws.isAlive=true;
    const current=agents.get(agentId);
    if(current?.ws===ws) current.lastSeen=now();
  });

  ws.send(JSON.stringify({
    type:'hello',
    agentId,
    connectionId,
    serverTime:now()
  }));

  dispatch().catch(e=>app.log.error(e));

  ws.on('message',async buf=>{
    let msg;
    try{
      msg=JSON.parse(buf.toString());
    }catch(error){
      app.log.warn({agentId,connectionId,error:error.message},'invalid agent message');
      return;
    }

    ws.isAlive=true;
    const current=agents.get(agentId);
    if(current?.ws===ws){
      current.lastSeen=now();
      if(msg.type==='agent:hello'||msg.type==='agent:status'){
        current.meta={...(current.meta||{}),...msg};
        delete current.meta.type;
        delete current.meta.agentId;
      }
    }

    const jobId=msg.jobId||msg.id;
    let status=null;
    if(msg.type==='job:done') status='done';
    else if(msg.type==='job:failed') status='failed';
    else if(msg.type==='job-status') status=msg.status;

    if(status&&jobId){
      const job=jobs.find(j=>j.id===jobId);
      if(job){
        job.status=status;
        job.error=msg.error||null;
        job.updatedAt=now();
        if(status==='done') job.doneAt=now();
        await saveJobs();

        if(job.telegram?.chatId&&['done','failed'].includes(status)){
          bot.sendMessage(
            job.telegram.chatId,
            status==='done'
              ? `✅ Напечатано: ${job.title}`
              : `❌ Ошибка печати: ${job.error||'unknown'}`
          ).catch(()=>{});
        }
      }
    }
  });

  ws.on('error',error=>{
    app.log.error({
      agentId,
      connectionId,
      error:error?.message||String(error)
    },'agent websocket error');
  });

  ws.on('close',(code,reason)=>{
    const current=agents.get(agentId);
    if(current?.ws===ws) agents.delete(agentId);

    app.log.warn({
      agentId,
      connectionId,
      code,
      reason:reason?.toString()||''
    },'agent disconnected');
  });
});

// RFC6455 ping/pong. Не зависит от JSON heartbeat агента.
const websocketHeartbeat=setInterval(()=>{
  for(const [agentId,record] of agents.entries()){
    const ws=record.ws;
    if(!ws||ws.readyState!==1){
      agents.delete(agentId);
      continue;
    }

    if(ws.isAlive===false){
      app.log.warn({
        agentId,
        connectionId:record.connectionId
      },'agent heartbeat timeout');
      ws.terminate();
      continue;
    }

    ws.isAlive=false;
    try{ ws.ping(); }
    catch(error){
      app.log.warn({agentId,error:error.message},'agent ping failed');
      ws.terminate();
    }
  }
},20000);
websocketHeartbeat.unref?.();

if(TELEGRAM_MODE==='webhook') await bot.setWebHook(`${BOT_PUBLIC_URL}${TELEGRAM_WEBHOOK_PATH}`,TELEGRAM_WEBHOOK_SECRET?{secret_token:TELEGRAM_WEBHOOK_SECRET}:undefined);
setTimeout(()=>monitorMarketplacePrintables(),5000);
setInterval(()=>monitorMarketplacePrintables(),MARKETPLACE_NOTIFY_MS);
console.log(`PrintHub server on ${server}; WebApp ${WEBAPP_URL}`);
