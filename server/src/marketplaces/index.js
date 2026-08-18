import {listOzonPrintables,downloadOzonPrintable} from './ozon.js';
import {listWbPrintables,downloadWbPrintable} from './wb.js';
import {listYandexPrintables,downloadYandexPrintable} from './yandex.js';
const loaders={ozon:downloadOzonPrintable,wb:downloadWbPrintable,yandex:downloadYandexPrintable};
export async function collectMarketplacePrintables(){
  const tasks=[['ozon',listOzonPrintables],['wb',listWbPrintables],['yandex',listYandexPrintables]];
  const docs=[]; const errors=[];
  await Promise.all(tasks.map(async([name,fn])=>{try{docs.push(...await fn());}catch(e){errors.push({marketplace:name,error:e.message});}}));
  docs.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return {documents:docs,errors,refreshedAt:new Date().toISOString()};
}
export async function downloadMarketplacePrintable(item){
  const fn=loaders[item.marketplace]; if(!fn) throw new Error(`Unknown marketplace ${item.marketplace}`); return fn(item);
}
