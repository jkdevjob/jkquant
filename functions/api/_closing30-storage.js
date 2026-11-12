// Closing research keeps the entire evidence set without exceeding DO's per-value limit.
export async function readSignalLedger(storage){
  const ledger=await storage.get('ledger');
  if(!ledger?.closingEventChunks)return ledger||null;
  const parts=await Promise.all(Array.from({length:ledger.closingEventChunks},(_,i)=>storage.get('closingEvents:'+i)));
  if(parts.some(x=>!Array.isArray(x)))throw Error('closing event chunk missing');
  return {...ledger,events:parts.flat()};
}
export async function writeSignalLedger(storage,ledger){
  if(!ledger.closingResearch)return storage.put('ledger',ledger);
  const chunks=[];let part=[],size=2;
  for(const event of ledger.events){
    const bytes=new TextEncoder().encode(JSON.stringify(event)).length+1;
    if(bytes>60000)throw Error('closing event too large');
    if(size+bytes>60000){chunks.push(part);part=[];size=2;}
    part.push(event);size+=bytes;
  }
  if(part.length)chunks.push(part);
  const header={...ledger,events:[],closingEventChunks:chunks.length};
  if(new TextEncoder().encode(JSON.stringify(header)).length>120000)throw Error('closing scan evidence too large');
  await storage.transaction(async tx=>{
    for(let i=0;i<chunks.length;i++)await tx.put('closingEvents:'+i,chunks[i]);
    await tx.put('ledger',header);
  });
}
