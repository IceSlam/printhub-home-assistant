import { fetchJson, fetchBinary, boolEnv, summarizeLineItems } from './common.js';
const API='https://api.partner.market.yandex.ru';
function headers(){ return {'Api-Key':process.env.YANDEX_API_KEY||'', 'Content-Type':'application/json'}; }
function campaigns(){return String(process.env.YANDEX_CAMPAIGN_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);}
export function yandexEnabled(){return boolEnv('YANDEX_ENABLED',true)&&process.env.YANDEX_API_KEY&&campaigns().length;}
export async function listYandexPrintables(){
  if(!yandexEnabled()) return [];
  const out=[];
  for(const campaignId of campaigns()){
    // Only orders for which labels are potentially relevant. UI receives normalized document entries, not order cards.
    const url=`${API}/v2/campaigns/${campaignId}/orders?status=PROCESSING&substatus=READY_TO_SHIP&pageSize=50`;
    const data=await fetchJson(url,{headers:headers()});
    const orders=data.orders||data.result?.orders||[];
    for(const o of orders) {
      const summary=summarizeLineItems(o.items || o.lines || [],{
        nameKeys:['offerName','offer_name','name','title','shopSku','sku'],
        qtyKeys:['count','quantity','qty'],
        assumeEachIsOne:true,
      });
      out.push({
        key:`yandex:order:${campaignId}:${o.id}`,
        marketplace:'yandex',
        kind:'shipment-label',
        title:'Ярлык отправления',
        subtitle:`Яндекс Маркет • ${o.id}`,
        itemName:summary.itemName||null,
        quantityText:summary.quantityText||null,
        size:'58x40',
        widthMm:58,
        heightMm:40,
        remoteId:String(o.id),
        campaignId,
        updatedAt:o.updatedAt||o.creationDate||new Date().toISOString()
      });
    }
  }
  return out;
}
export async function downloadYandexPrintable(item){
  // Current Yandex Partner API method for a ready label of one FBS/DBS order.
  const url=`${API}/v2/campaigns/${item.campaignId}/orders/${item.remoteId}/delivery/labels`;
  return fetchBinary(url,{headers:headers()});
}
