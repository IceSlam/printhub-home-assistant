import { fetchJson, boolEnv, summarizeLineItems } from './common.js';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
const API='https://marketplace-api.wildberries.ru';
function headers(){return {Authorization:process.env.WB_API_TOKEN||'', 'Content-Type':'application/json'};}
export function wbEnabled(){return boolEnv('WB_ENABLED',true)&&process.env.WB_API_TOKEN;}
export async function listWbPrintables(){
  if(!wbEnabled()) return [];
  const data=await fetchJson(`${API}/api/v3/orders/new`,{headers:headers()});
  const orders=data.orders||[];
  return orders.map(o=>{
    const summary=summarizeLineItems([o],{
      nameKeys:['supplierArticle','article','subject','brand','nmId','barcode'],
      qtyKeys:['quantity','qty','count'],
      assumeEachIsOne:true,
    });
    return {
      key:`wb:order:${o.id}`,
      marketplace:'wb',
      kind:'shipment-label',
      title:'Стикер сборочного задания',
      subtitle:`Wildberries • ${o.id}`,
      itemName:summary.itemName||null,
      quantityText:summary.quantityText||'1 шт.',
      size:'58x40',
      widthMm:58,
      heightMm:40,
      remoteId:o.id,
      updatedAt:o.createdAt||new Date().toISOString()
    };
  });
}
async function pngToPdf(png,widthMm=58,heightMm=40){
  const normalized=await sharp(png).png().toBuffer(); const doc=await PDFDocument.create();
  const page=doc.addPage([widthMm/25.4*72,heightMm/25.4*72]); const img=await doc.embedPng(normalized);
  page.drawImage(img,{x:0,y:0,width:page.getWidth(),height:page.getHeight()}); return Buffer.from(await doc.save());
}
export async function downloadWbPrintable(item){
  const data=await fetchJson(`${API}/api/v3/orders/stickers?type=png&width=58&height=40`,{method:'POST',headers:headers(),body:JSON.stringify({orders:[Number(item.remoteId)]})});
  const sticker=(data.stickers||[])[0]; if(!sticker) throw new Error('WB не вернул стикер');
  const b64=sticker.file||sticker.content||sticker.data; if(!b64) throw new Error('WB стикер без изображения');
  return pngToPdf(Buffer.from(b64,'base64'));
}
