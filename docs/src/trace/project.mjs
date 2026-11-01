import { validateBuilding, createBuildingLayout } from '../building/layout.mjs';
import { validateTracePage, toWallDraft } from './data.mjs';
import { validRegion } from '../ai/regions.mjs';
import { validateSavedAnalysis } from '../ai/analysis.mjs';

export const TRACE_PROJECT_FORMAT = 'ai-house-trace-project';
export const TRACE_PROJECT_VERSION = 1;
export const MAX_PROJECT_BYTES = 5 * 1024 * 1024;
export const TRACE_MODES = ['navigate', 'calibrate', 'wall', 'edit'];
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const positive = v => typeof v === 'number' && Number.isFinite(v) && v > 0;
const integer = (v, max) => Number.isSafeInteger(v) && v >= 1 && v <= max;
const clone = v => JSON.parse(JSON.stringify(v));

// This is a working document, not a completed ai-house-plan. Never invent a footprint/floor.
export function validateTraceProject(data, allowWindows=false) {
  const errors = [];
  const issue = (path, message) => { if (errors.length < 50) errors.push({ path, message }); };
  function shape(v, keys, path) {
    if (!record(v)) { issue(path, 'オブジェクトが必要です。'); return false; }
    for (const key of keys) if (!Object.hasOwn(v, key)) issue(`${path}/${key}`, '必須項目がありません。');
    for (const key of Object.keys(v)) if (!keys.includes(key)) issue(path, '未定義の項目があります。形式を確認してください。');
    return true;
  }
  function point(v, path, bound = 1e9) {
    if (!Array.isArray(v) || v.length !== 2 || !v.every(n=>typeof n==='number' && Number.isFinite(n) && n>=0 && n<=bound)) issue(path, '2要素の有限な図面座標が必要です。');
  }
  if (!shape(data, ['format','schemaVersion','units','coordinateSystem','source','pages','editor', ...([2,3,4].includes(data?.schemaVersion)?['analyses']:[]),...([3,4].includes(data?.schemaVersion)?['floors','activeFloorId',...(Object.hasOwn(data||{},'building')?['building']:[])]:[])], '')) return { valid:false, errors };
  if (data.format !== TRACE_PROJECT_FORMAT) issue('/format', '壁入力の作業保存JSONではありません。');
  if (![1,2,3,4].includes(data.schemaVersion)) issue('/schemaVersion', '対応する保存形式のバージョンは1・2・3・4です。');
  if (data.units !== 'm') issue('/units', '実寸の単位はmが必要です。');
  if (shape(data.coordinateSystem,['plane','up'],'/coordinateSystem') && (data.coordinateSystem.plane!=='xz'||data.coordinateSystem.up!=='y')) issue('/coordinateSystem','座標系は平面xz・上方向yが必要です。');
  const source = data.source;
  if (shape(source,['kind','byteLength','sha256','pageCount'],'/source')) {
    if (!['image','pdf'].includes(source.kind)) issue('/source/kind','図面の種類はimageまたはpdfです。');
    if (!integer(source.byteLength,25*1024*1024)) issue('/source/byteLength','元図面の容量は1バイト〜25MiBにしてください。');
    if (typeof source.sha256!=='string'||!/^[a-f0-9]{64}$/.test(source.sha256)) issue('/source/sha256','元図面のSHA-256指紋が不正です。');
    if (!integer(source.pageCount,10000)||(source.kind==='image'&&source.pageCount!==1)) issue('/source/pageCount','ページ数が不正です。画像は1ページ、PDFは1〜10,000ページです。');
  }
  if (!Array.isArray(data.pages)||data.pages.length<1||data.pages.length>100) {
    issue('/pages','保存するページは1〜100件です。'); return {valid:false,errors};
  }
  const pageIds = new Set(), wallIds = new Set();
  data.pages.forEach((p,i)=>{
    const path=`/pages/${i}`;
    if (!shape(p,['page','sourceSize','sourceUnit','calibration','sourceWalls','nextId',...((data.schemaVersion===4||allowWindows)&&Object.hasOwn(p||{},'openings')?['openings']:[])],path)) return;
    if (!integer(p.page,source?.pageCount)||pageIds.has(p.page)) issue(`${path}/page`,'ページ番号が範囲外、または重複しています。');
    pageIds.add(p.page);
    point(p.sourceSize,`${path}/sourceSize`);
    if (p.sourceUnit!==(source?.kind==='pdf'?'pt':'px')) issue(`${path}/sourceUnit`,'図面の種類と座標単位が一致しません。');
    if (!integer(p.nextId,1e9)) issue(`${path}/nextId`,'次の壁ID番号が不正です。');
    if (!Array.isArray(p.sourceWalls)||p.sourceWalls.length>500) { issue(`${path}/sourceWalls`,'壁は1ページ500件までの配列にしてください。'); return; }
    p.sourceWalls.forEach((wall,j)=>{
      const wp=`${path}/sourceWalls/${j}`;
      if(!shape(wall,['id','start','end','height','thickness'],wp))return;
      const match=typeof wall.id==='string'&&wall.id.match(/^manual-p([1-9]\d*)-w([1-9]\d*)$/);
      if (!match || Number(match[1])!==p.page || !integer(Number(match[2]),1e9) || Number(match[2])>=p.nextId || wallIds.has(wall.id)) issue(`${wp}/id`,'壁IDの重複、ページ対応、または次のID番号との関係が不正です。');
      wallIds.add(wall.id);
      point(wall.start,`${wp}/start`); point(wall.end,`${wp}/end`);
      for(const key of ['height','thickness'])if(!positive(wall[key])||wall[key]>100000)issue(`${wp}/${key}`,'壁の高さ・厚みは0より大きく100,000m以下にしてください。');
    });
    if (p.calibration!==null) {
      const c=p.calibration;
      if(shape(c,['sourcePoints','metres'],`${path}/calibration`)) {
        if(!Array.isArray(c.sourcePoints)||c.sourcePoints.length!==2)issue(`${path}/calibration/sourcePoints`,'縮尺には2点が必要です。');
        else c.sourcePoints.forEach((p,j)=>point(p,`${path}/calibration/sourcePoints/${j}`));
        if(!positive(c.metres))issue(`${path}/calibration/metres`,'縮尺の実距離は正の有限値にしてください。');
      }
    }
    const checked=validateTracePage(p);
    checked.errors.forEach(e=>issue(path,e.message));
    if(checked.valid)try{toWallDraft(p);}catch(error){issue(path,error.message);}
  });
  const editor=data.editor;
  if(shape(editor,['page','mode','selectedWallId','height','thickness'],'/editor')) {
    if(!pageIds.has(editor.page))issue('/editor/page','編集中のページが保存ページにありません。');
    if(!TRACE_MODES.includes(editor.mode))issue('/editor/mode','編集モードが不正です。');
    const activeWalls=data.pages.find(p=>p?.page===editor.page)?.sourceWalls;
    if(editor.selectedWallId!==null && (!Array.isArray(activeWalls)||!activeWalls.some(w=>w?.id===editor.selectedWallId)))issue('/editor/selectedWallId','選択した壁が編集中のページにありません。');
    for(const key of ['height','thickness'])if(!positive(editor[key])||editor[key]>100000)issue(`/editor/${key}`,'入力中の高さ・厚みは0より大きく100,000m以下にしてください。');
  }
  if([2,3,4].includes(data.schemaVersion)){
    if(!Array.isArray(data.analyses)||data.analyses.length>100)issue('/analyses','AI解析情報は100ページまでです。');
    else if(!errors.length){const ids=new Set();for(const entry of data.analyses){if(!validateSavedAnalysis(entry,data.pages)||ids.has(entry.page))issue('/analyses','AI解析情報・壁参照・ページ対応が不正です。');ids.add(entry?.page);}}
  }
  if([3,4].includes(data.schemaVersion)){
    if(data.schemaVersion!==4&&(data.building?.stairs?.length||data.building?.appearance||(Array.isArray(data.building?.levels)&&data.building.levels.some(l=>Object.hasOwn(l||{},'colors')))))issue('/building/stairs','階段・表示設定を含む保存にはv4が必要です。');
    if(Object.hasOwn(data,'building'))for(const e of validateBuilding(data.building,Array.isArray(data.floors)?data.floors.map(f=>f?.id):[]).errors)issue(e.path,e.message);
    if(!Array.isArray(data.floors)||data.floors.length<1||data.floors.length>20)issue('/floors','階別作業は1〜20件です。');
    else {
      const ids=new Set();
      for(const [i,f] of data.floors.entries()){
        const path=`/floors/${i}`;
        if(!shape(f,['id','name','sourcePage','region','state',...(Object.hasOwn(f||{},'assumedScale')?['assumedScale']:[])],path))continue;
        if(typeof f.id!=='string'||!/^floor-[1-9]\d*$/.test(f.id)||ids.has(f.id))issue(path,'階IDが不正または重複しています。');ids.add(f.id);
        if(Object.hasOwn(f,'assumedScale')&&typeof f.assumedScale!=='boolean')issue(path,'仮寸法フラグは真偽値です。');
        if(typeof f.name!=='string'||!f.name.trim()||f.name.length>40||!integer(f.sourcePage,source?.pageCount)||!validRegion(f.region))issue(path,'階名・元ページ・解析範囲が不正です。');
        if(!shape(f.state,['pages','editor','analyses'],path+'/state'))continue;
        if(!Array.isArray(f.state.pages)||f.state.pages.length!==1||f.state.pages[0]?.page!==f.sourcePage)issue(path,'階と元ページが一致しません。');
        if(validRegion(f.region)&&Array.isArray(f.state.pages))for(const page of f.state.pages){
          if(!record(page)||!Array.isArray(page.sourceWalls)||!Array.isArray(page.sourceSize))continue;
          const [x,y,w,h]=f.region;
          for(const wall of page.sourceWalls){if(!record(wall))continue;for(const p of [wall.start,wall.end])if(Array.isArray(p)&&(p[0]/page.sourceSize[0]<x-1e-6||p[0]/page.sourceSize[0]>x+w+1e-6||p[1]/page.sourceSize[1]<y-1e-6||p[1]/page.sourceSize[1]>y+h+1e-6))issue(path,'階の解析範囲外に壁があります。');}
        }
        const nested={format:data.format,schemaVersion:2,units:data.units,coordinateSystem:data.coordinateSystem,source:data.source,...f.state};
        for(const e of validateTraceProject(nested,data.schemaVersion===4).errors)issue(path+e.path,e.message);
      }
      if(data.activeFloorId!==null&&!ids.has(data.activeFloorId))issue('/activeFloorId','選択中の階が存在しません。');
      if(data.building?.stairs?.length&&!errors.length){const layout=createBuildingLayout(data.floors,data.building);if(!layout.valid)for(const e of layout.errors)issue('/building/stairs',e.message);else for(const message of layout.stairErrors)issue('/building/stairs',message);}
    }
  }
  return { valid:errors.length===0, errors };
}

export function parseTraceProject(text) {
  if(typeof text!=='string'||text.length>MAX_PROJECT_BYTES||new TextEncoder().encode(text).length>MAX_PROJECT_BYTES) return {valid:false,errors:[{path:'/',message:'保存JSONは5MiB以内にしてください。'}]};
  let data;
  try { data=JSON.parse(text.replace(/^\uFEFF/,'')); }
  catch { return {valid:false,errors:[{path:'/',message:'JSONの書式を読み取れません。ファイルを確認してください。'}]}; }
  const result=validateTraceProject(data);
  return result.valid?{...result,data}:result;
}
export function createTraceProject(source, state) {
  const data={format:TRACE_PROJECT_FORMAT,schemaVersion:((Array.isArray(state.building?.levels)&&state.building.levels.some(l=>Object.hasOwn(l||{},'colors')))||state.building?.appearance||state.building?.stairs?.length||state.floors?.some(f=>f.state.pages.some(p=>Object.hasOwn(p,'openings'))))?4:state.floors?.length?3:state.analyses?.length?2:TRACE_PROJECT_VERSION,units:'m',coordinateSystem:{plane:'xz',up:'y'},source,pages:state.pages,editor:state.editor,...((state.analyses?.length||state.floors?.length)?{analyses:state.analyses||[]}:{}),...(state.floors?.length?{floors:state.floors,activeFloorId:state.activeFloorId,...(state.building?{building:state.building}:{})}:{})};
  const checked=validateTraceProject(data);
  if(!checked.valid)throw new Error(checked.errors.map(e=>`${e.path}: ${e.message}`).join('\n'));
  return clone(data);
}
export function serializeTraceProject(data) {
  const checked=validateTraceProject(data);
  if(!checked.valid)throw new Error(checked.errors.map(e=>`${e.path}: ${e.message}`).join('\n'));
  const text=JSON.stringify(data,null,2)+'\n';
  if(new TextEncoder().encode(text).length>MAX_PROJECT_BYTES)throw new Error('保存JSONが5MiBを超えます。');
  return text;
}
export async function fingerprintDrawing(file, kind, subtle=globalThis.crypto?.subtle) {
  if(!subtle)throw new Error('この環境ではファイル指紋を計算できません。localhostまたは127.0.0.1から開いてください。');
  if(!['image','pdf'].includes(kind)||!integer(file.size,25*1024*1024))throw new Error('元図面の種類・容量が不正です。');
  const digest=await subtle.digest('SHA-256',await file.arrayBuffer());
  return {kind,byteLength:file.size,sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')};
}
export function compareTraceSource(project, actual) {
  const checked=validateTraceProject(project);
  if(!checked.valid)return {matches:false,issues:checked.errors.map(e=>e.message)};
  if(!actual)return {matches:false,issues:['元の平面図を再選択してください。図面なしでも保存JSONの検査は完了しています。']};
  const issues=[], expected=project.source, found=actual.source;
  if(!found || expected.kind!==found.kind)issues.push('図面の種類が保存データと一致しません。');
  if(expected.sha256!==found?.sha256)issues.push('ファイル指紋が異なります。別の図面、または変更された図面の可能性があります。');
  if(expected.byteLength!==found?.byteLength)issues.push('元図面のファイル容量が一致しません。');
  if(expected.pageCount!==found?.pageCount)issues.push('PDFのページ数、または画像のページ数が一致しません。');
  for(const page of allTracePages(project)) {
    const p=actual.pages?.find(p=>p.page===page.page);
    if(!p || p.sourceUnit!==page.sourceUnit || !Array.isArray(p.sourceSize) || p.sourceSize.length!==2 || p.sourceSize.some((n,i)=>!Number.isFinite(n)||Math.abs(n-page.sourceSize[i])>1e-6))issues.push(`${page.page}ページの画像／PDF寸法・座標単位が一致しません。`);
  }
  return {matches:issues.length===0,issues};
}

export function allTracePages(project){return [...project.pages,...(project.floors||[]).flatMap(f=>f.state.pages)];}
export function activeTraceEditor(project){return project.floors?.find(f=>f.id===project.activeFloorId)?.state.editor||project.editor;}
