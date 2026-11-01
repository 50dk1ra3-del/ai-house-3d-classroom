import { addTraceWall, calibrateTrace } from '../trace/data.mjs';
export const MODEL = 'gpt-5.4-mini-2026-03-17';
const point=p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=1);
const confidence=n=>Number.isFinite(n)&&n>=0&&n<=1;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=v=>typeof v==='string'&&v.length<=500;
const copy=v=>JSON.parse(JSON.stringify(v));
// Untrusted model output never reaches the editor without this check.
export function validateAnalysis(data) {
  const errors=[];
  const issue=m=>{if(errors.length<30)errors.push(m);};
  if(!object(data))return {valid:false,errors:['解析結果がオブジェクトではありません。']};
  const keys=['analysisVersion','walls','rooms','openings','furniture','annotations','unknown','summary'];
  if(keys.some(k=>!Object.hasOwn(data,k))||Object.keys(data).some(k=>!keys.includes(k)))issue('解析結果の項目が不正です。');
  if(data.analysisVersion!==1||!text(data.summary))issue('解析形式または説明が不正です。');
  for(const k of keys.slice(1,-1))if(!Array.isArray(data[k])||data[k].length>200)issue(`${k}は200件までの配列にしてください。`);
  if(errors.length)return {valid:false,errors};
  const ids=new Set();
  function shape(v,fields){return object(v)&&Object.keys(v).length===fields.length&&fields.every(k=>Object.hasOwn(v,k));}
  for(const w of data.walls){
    if(!shape(w,['id','start','end','confidence'])||typeof w.id!=='string'||!/^w[1-9]\d{0,3}$/.test(w.id)||ids.has(w.id)||!point(w.start)||!point(w.end)||!confidence(w.confidence)||Math.hypot(w.start[0]-w.end[0],w.start[1]-w.end[1])<.001)issue('壁ID・端点・信頼度が不正です。');
    ids.add(w?.id);
  }
  for(const r of data.rooms)if(!shape(r,['name','outline','confidence'])||!text(r.name)||!Array.isArray(r.outline)||r.outline.length<3||r.outline.length>30||!r.outline.every(point)||!confidence(r.confidence))issue('部屋の輪郭・名称が不正です。');
  for(const o of data.openings)if(!shape(o,['kind','wallId','position','confidence'])||!['door','window','opening'].includes(o.kind)||!ids.has(o.wallId)||!point(o.position)||!confidence(o.confidence))issue('ドア・窓の壁参照または位置が不正です。');
  for(const f of data.furniture)if(!shape(f,['kind','center','size','rotationDeg','confidence'])||!['bed','sofa','table','chair','storage','other'].includes(f.kind)||!point(f.center)||!point(f.size)||f.size.some(n=>n<=0)||!Number.isFinite(f.rotationDeg)||Math.abs(f.rotationDeg)>360||!confidence(f.confidence))issue('家具の種類・位置・向きが不正です。');
  for(const a of data.annotations)if(!shape(a,['kind','text','position'])||!['text','dimension'].includes(a.kind)||!text(a.text)||!point(a.position))issue('文字・寸法情報が不正です。');
  for(const u of data.unknown)if(!shape(u,['description','position'])||!text(u.description)||!point(u.position))issue('判別不能な要素の情報が不正です。');
  return {valid:!errors.length,errors};
}
export function applyAnalysis(page,result,model=MODEL) {
  const checked=validateAnalysis(result);
  if(!checked.valid)throw new Error(checked.errors.join('\n'));
  const walls=result.walls.filter(w=>w.confidence>=.35);
  if(!walls.length)throw new Error('壁を認識できませんでした。図面は保持しています。線の明瞭な写真で再試行するか、手動入力してください。');
  let next=copy(page);
  const assumedScale=!next.calibration;
  if(assumedScale)next=calibrateTrace(next,[0,0],[page.sourceSize[0],0],10);
  const map=[];
  for(const w of walls){
    const convert=p=>p.map((v,i)=>v*page.sourceSize[i]);
    next=addTraceWall(next,convert(w.start),convert(w.end));
    map.push({analysisId:w.id,wallId:next.sourceWalls.at(-1).id});
  }
  return {page:next,analysis:{page:page.page,assumedScale,model,result:copy(result),wallMap:map}};
}
export function validateSavedAnalysis(entry,pages) {
  if(!object(entry)||Object.keys(entry).length!==5||!['page','assumedScale','model','result','wallMap'].every(k=>Object.hasOwn(entry,k)))return false;
  const page=pages.find(p=>p.page===entry.page);
  if(!page||typeof entry.assumedScale!=='boolean'||typeof entry.model!=='string'||entry.model.length>100||!validateAnalysis(entry.result).valid||!Array.isArray(entry.wallMap)||entry.wallMap.length>200)return false;
  const used=new Set();
  return entry.wallMap.every(m=>object(m)&&Object.keys(m).length===2&&entry.result.walls.some(w=>w.id===m.analysisId)&&page.sourceWalls.some(w=>w.id===m.wallId)&&!used.has(m.wallId)&&!!used.add(m.wallId));
}

export function addRoomLabels(layout,page,metadata) {
  if(!layout.valid||!page.calibration||!metadata)return layout;
  const [a,b]=page.calibration.sourcePoints;
  const scale=page.calibration.metres/Math.hypot(a[0]-b[0],a[1]-b[1]);
  return {...layout,labels:metadata.result.rooms.filter(r=>r.confidence>=.35).map((r,i)=>({
    id:`ai-room-${i}`,text:`${r.name}（推定）`,position:[
      r.outline.reduce((sum,p)=>sum+p[0],0)/r.outline.length*page.sourceSize[0]*scale,.04,
      r.outline.reduce((sum,p)=>sum+p[1],0)/r.outline.length*page.sourceSize[1]*scale]}))};
}

// Preserve provenance when a user accepts additional candidates in the same workspace.
export function mergeAnalysis(previous,next){
 if(!previous)return next;
 if(previous.page!==next.page)throw new Error('別ページの解析結果は統合できません。');
 const old=JSON.parse(JSON.stringify(previous));
 if(old.result.walls.length+next.result.walls.length>200)throw new Error('この作業の解析候補は200件までです。別の階別作業を作成してください。');
 let number=0;const used=new Set(old.result.walls.map(w=>w.id));
 const ids=new Map(next.result.walls.map(w=>{while(used.has(`w${++number}`)){}const id=`w${number}`;used.add(id);return[w.id,id];}));
 const result={...next.result,walls:[...old.result.walls,...next.result.walls.map(w=>({...w,id:ids.get(w.id)}))],openings:next.result.openings.map(o=>({...o,wallId:ids.get(o.wallId)}))};
 return {...next,model:old.model===next.model?next.model:'mixed',assumedScale:old.assumedScale||next.assumedScale,result,wallMap:[...old.wallMap,...next.wallMap.map(m=>({...m,analysisId:ids.get(m.analysisId)}))]};
}
