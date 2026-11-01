import {stairFromRectangle} from '../building/stair-placement.mjs';
import {putWindow,removeWindow} from '../building/openings.mjs';
import { createBuildingLayout, ensureBuilding, validateBuilding } from '../building/layout.mjs';
import { TraceHistory } from './history.mjs';
import { mountShapeEditor } from './editor.mjs';
import { createTracePage, calibrateTrace, addTraceWall, updateTraceWall, deleteTraceWall,
  validateTracePage, sourcePointFromClient, toWallDraft, createWallPreview } from './data.mjs';
import { applyAnalysis, addRoomLabels, mergeAnalysis } from '../ai/analysis.mjs';
import { assistedPoint, estimatedFloorCalibration } from './input.mjs';
import { validRegion } from '../ai/regions.mjs';
import { FloorWorkspaces } from './workspaces.mjs';
import { validateTraceProject } from './project.mjs';

export function mountTraceControls(host, { preview, getElement, update3D, showPlanTab }) {
  host.innerHTML = `<h2 class="section-heading">2. 壁をなぞって3D化</h2>
    <p class="hint">階の範囲を登録 → 仮寸法または実距離で縮尺設定 → 四角形・壁線をドラッグ。追加した壁はすぐ3Dに反映します。授業版は手動で描きます。図面の変更前に保存してください。</p>
    <p id="tracePageInfo" class="hint">図面を読み込んでください。</p>
    <fieldset id="traceFields" disabled>
      <button id="traceEstimate" class="button" type="button">仮の大きさで始める（この階の横幅10m）</button>
      <details><summary>従来の2点入力・縮尺の設定</summary><div class="trace-actions"><button id="traceBrowse" class="button" type="button">閲覧・移動</button><button id="traceDraw" class="button" type="button">壁を描く</button><button id="traceEdit" class="button" type="button">壁を修正</button></div>
      <label><input id="traceSnap" type="checkbox" checked /> 近い端点に吸着</label><label><input id="traceAxis" type="checkbox" checked /> 水平・垂直を補助（Altで一時解除）</label>
      <button id="traceCancelPoint" class="button" type="button">入力中の点を取り消す（Esc）</button>
      <label for="traceMode">図面の操作モード</label>
      <select id="traceMode"><option value="navigate">閲覧・拡大・移動</option><option value="calibrate">縮尺の2点を指定</option><option value="wall">壁の2点を入力</option><option value="edit">壁を選択・位置修正</option></select>
      <label for="traceDistance">縮尺の実距離（m）</label>
      <input id="traceDistance" type="number" min="0.000001" step="any" placeholder="例：6" />
      <button id="traceCalibrate" class="button" type="button">2点の距離で縮尺を設定</button>
      </details><p id="traceScaleInfo" class="hint">縮尺未設定</p>
      <label for="traceHeight">壁の高さ（m）</label><input id="traceHeight" type="number" min="0.000001" step="any" value="2.7" />
      <label for="traceThickness">壁の厚み（m）</label><input id="traceThickness" type="number" min="0.000001" step="any" value="0.16" />
      <label for="traceWall">登録した壁</label><select id="traceWall"><option value="">壁を選択</option></select>
      <div class="trace-actions"><button id="traceStart" type="button" class="button">始点を置き直す</button><button id="traceEnd" type="button" class="button">終点を置き直す</button><button id="traceDimensions" type="button" class="button">選択壁の高さ・厚みを更新</button><button id="traceDelete" type="button" class="button">選択壁を削除</button></div>
      <button id="traceShow3D" type="button" class="button">この階の壁を3D表示</button>
      <details><summary>壁の下書きJSONを確認</summary><textarea id="traceJson" rows="10" readonly aria-label="壁の下書きJSON"></textarea></details>
    </fieldset><p id="traceResult" class="hint" role="status" aria-live="polite">縮尺未設定では実寸3D生成できません。</p>`;
  const $ = id => host.querySelector(`#${id}`);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.tabIndex=0;svg.classList.add('trace-overlay'); svg.setAttribute('aria-label', '縮尺と壁を入力する図面');
  preview.append(svg);
  const workspaces = new FloorWorkspaces();
  const analyses = new Map();
  const pages = new Map(), listeners = new Set();
  let building=null,buildingView='active',stairDraft=null;
  let shapeEditor=null;const histories=new TraceHistory(),stable=new Map();
  const historyKey=()=>`${workspaces.activeId||'base'}:${current}`;
  const checkpoint=()=>({state:snapshot(),stairs:structuredClone(building?.stairs||null),assumedScale:!!workspaces.active()?.assumedScale});
  function undo(){if(stairDraft){stairDraft=null;refresh();report('階段の未確定範囲を取り消しました。登録済みの階段は保持しています。');return;}const previous=histories.take(historyKey());if(!previous){report('元に戻せる操作がありません。');return;}const candidate=workspaces.save(snapshot());const floor=candidate.floors?.find(f=>f.id===workspaces.activeId);if(floor)floor.state=previous.state;const config=ensureBuilding(building,candidate.floors||[]);if(previous.restoreStairs){if(previous.stairs)config.stairs=previous.stairs;else delete config.stairs;}const test=createBuildingLayout(candidate.floors||[],config);if(!test.valid||test.stairErrors?.length){histories.record(historyKey(),previous);report('階段と他階の変更が干渉するため取り消せません。先に階段を移動・削除してください。');return;}if(previous.restoreStairs)building=config;const resumeTool=shapeEditor?.tool;if(workspaces.active())workspaces.active().assumedScale=previous.assumedScale;loadWorkspace(previous.state);stable.set(historyKey(),checkpoint());if(resumeTool)shapeEditor.activate(resumeTool,false);report('直前の変更を元に戻しました。');}
  let resumeEditor = null;
  let current = null, selected = '', points = [], relocating = null, hover=null;
  const page = () => pages.get(current);
  const report = text => { $('traceResult').textContent = text; };
  function attempt(action) { try { action(); } catch (error) { report(error.message); } }
  function clearPending() { points = []; relocating = null; hover=null; }
  function selectedFields() {
    const wall = page()?.sourceWalls.find(w => w.id === selected);
    if (wall) { $('traceHeight').value = wall.height; $('traceThickness').value = wall.thickness; }
    for (const id of ['traceStart', 'traceEnd', 'traceDelete', 'traceDimensions']) $(id).disabled = !wall;
  }
  function snapshot(){return {pages:JSON.parse(JSON.stringify([...pages.values()].sort((a,b)=>a.page-b.page))),editor:{page:current??workspaces.active()?.sourcePage??pages.keys().next().value,mode:$('traceMode').value,selectedWallId:selected||null,height:Number($('traceHeight').value),thickness:Number($('traceThickness').value)},analyses:JSON.parse(JSON.stringify([...analyses.values()]))};}
  function loadWorkspace(state){shapeEditor?.deactivate();analyses.clear();(state.analyses||[]).forEach(a=>analyses.set(a.page,a));pages.clear();state.pages.forEach(p=>pages.set(p.page,p));selected=state.editor.selectedWallId||'';current=state.editor.page;$('traceMode').value=state.editor.mode;$('traceHeight').value=state.editor.height;$('traceThickness').value=state.editor.thickness;clearPending();refresh();publish();stable.set(historyKey(),checkpoint());}
  function refresh() {
    const p = page();
    $('traceFields').disabled = !p;
    $('traceEstimate').disabled=!p||!workspaces.active();
    for(const [id,mode]of [['traceBrowse','navigate'],['traceDraw','wall'],['traceEdit','edit']])$(id).setAttribute('aria-pressed',String($('traceMode').value===mode));
    $('tracePageInfo').textContent = p ? `${workspaces.active()?.name||"全体・手動作業"} / ${p.page}ページ / ${p.sourceSize.map(v=>Math.round(v*100)/100).join(' × ')} ${p.sourceUnit} / 壁${p.sourceWalls.length}件` : '図面を読み込むか、ページの描画完了を待ってください。';
    $('traceWall').replaceChildren(new Option('壁を選択', ''));
    if (p) {
      let draft;
      try { draft = toWallDraft(p);if(draft.drawing.calibration&&(workspaces.active()?.assumedScale||analyses.get(current)?.assumedScale))draft.drawing.calibration.status='assumed';draft.review={...draft.review,source:analyses.has(current)?'ai-assisted':'manual',floor:workspaces.active()?.name||null}; $('traceJson').value = JSON.stringify(draft, null, 2); }
      catch (error) { $('traceJson').value = ''; report(error.message); }
      for (const wall of p.sourceWalls) {
        const length = draft?.wallLengths.find(w=>w.wallId===wall.id)?.metres;
        const link=analyses.get(current)?.wallMap.find(m=>m.wallId===wall.id);const inferred=link&&analyses.get(current).result.walls.find(w=>w.id===link.analysisId);
        const label=inferred?(inferred.confidence===.4?'画像補助':'AI推定／支持'):'手動';
        $('traceWall').add(new Option(`壁${p.sourceWalls.indexOf(wall)+1}（${label}） / ${length == null ? '縮尺未設定' : length.toFixed(3)+' m'}`, wall.id));
      }
      $('traceScaleInfo').textContent = p.calibration ? (workspaces.active()?.assumedScale||analyses.get(current)?.assumedScale?'仮寸法です。この階の範囲の横幅＝10m。実寸ではありません。':`縮尺設定済み：指定した2点＝${p.calibration.metres} m`) : '縮尺未設定：2点を選び、実距離を入力してください。';
    } else { $('traceJson').value = ''; $('traceScaleInfo').textContent = '縮尺未設定'; }
    $('traceWall').value = selected;
    selectedFields(); syncOverlay(); if(p&&!stable.has(historyKey()))stable.set(historyKey(),checkpoint());listeners.forEach(fn=>fn());
  }
  function publish(show = false) {
    const p=page();const state=workspaces.save(snapshot());
    const layout=state.floors?.length?createBuildingLayout(state.floors,building,buildingView,workspaces.activeId):p?addRoomLabels(createWallPreview(p),p,analyses.get(current)):null;
    let updated=false;try{updated=update3D(layout, show);}catch(error){report('3D更新に失敗しました。壁データは保持しています。'+error.message);return '3D更新に失敗しました。壁データは保持しています。';}
    if (show && layout?.valid && layout.boxes.length) report(updated ? 'このページの壁だけを3D表示しています。完成した住宅ではありません。' : '3D表示の準備ができていません。再試行してください。');
    const issue = layout?.errors?.map(e=>e.message).join('\n') || (layout?.boxes.length && !updated ? '3Dの更新ができませんでした。表示の準備完了後に再試行してください。' : '');
    if (show && (!layout?.valid || !layout.boxes.length)) report(issue || 'このページには壁がありません。壁の2点を入力してください。');
    return issue;
  }
  function applyBuilding(next){if(!workspaces.floors.length)throw new Error('先に階の範囲を登録してください。');const check=validateBuilding(next,workspaces.floors.map(f=>f.id));if(!check.valid)throw new Error(check.errors.map(e=>e.message).join('\n'));const state=workspaces.save(snapshot()),layout=createBuildingLayout(state.floors,next);if(layout.stairErrors?.length)throw new Error(layout.stairErrors.join('\n'));if(JSON.stringify(building?.stairs)!==JSON.stringify(next.stairs)){const previous={...checkpoint(),restoreStairs:true};histories.record(historyKey(),previous);stable.clear();}building=structuredClone(next);refresh();publish();stable.set(historyKey(),checkpoint());}
  function changed(next, message) {
    if(next.openings)next.openings=next.openings.filter(o=>next.sourceWalls.some(w=>w.id===o.wallId));const check=validateTracePage(next);if(!check.valid)throw new Error(check.errors.map(e=>e.message).join('\n'));
    if(next.sourceWalls.length&&!next.calibration&&workspaces.active()){next=estimatedFloorCalibration(next,workspaces.active().region);workspaces.active().assumedScale=true;message+='\n縮尺未設定のため、この階の横幅10mの仮寸法で3D化しました。実寸ではありません。';}
    if(building?.stairs?.length){const candidate=workspaces.save(snapshot());const f=candidate.floors?.find(f=>f.id===workspaces.activeId);if(f)f.state.pages=[next];const layout=createBuildingLayout(candidate.floors,building);if(layout.stairErrors?.length)throw new Error(layout.stairErrors.join('\n'));}
    const key=historyKey();if(stable.has(key)){const previous=stable.get(key);if(JSON.stringify(previous.state.pages)!==JSON.stringify([...pages.values()].map(p=>p.page===current?next:p))||JSON.stringify(previous.state.analyses)!==JSON.stringify([...analyses.values()])||previous.assumedScale!==!!workspaces.active()?.assumedScale)histories.record(key,previous);}
    pages.set(current, next);if(!next.sourceWalls.some(w=>w.id===selected))selected='';
    if(analyses.has(current))analyses.get(current).wallMap=analyses.get(current).wallMap.filter(m=>next.sourceWalls.some(w=>w.id===m.wallId));
    refresh(); const issue=publish();stable.set(historyKey(),checkpoint()); report(message+(issue?'\n'+issue:''));
  }
  function syncOverlay() {
    const p = page(), element = getElement();
    svg.replaceChildren();
    svg.style.display = p && element && !element.hidden && preview.classList.contains('visible') ? 'block' : 'none';
    svg.style.pointerEvents = $('traceMode').value === 'navigate' ? 'none' : 'auto';
    if (!p || !element || element.hidden) return;
    const rect = element.getBoundingClientRect(), parent = preview.getBoundingClientRect();
    Object.assign(svg.style, { left: `${rect.left-parent.left-preview.clientLeft}px`, top: `${rect.top-parent.top-preview.clientTop}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    svg.setAttribute('viewBox', `0 0 ${p.sourceSize[0]} ${p.sourceSize[1]}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    const radius = 5 * p.sourceSize[0] / Math.max(1, rect.width);
    function line(a, b, color, id) {
      const node = document.createElementNS(svg.namespaceURI, 'line');
      for (const [k,v] of Object.entries({x1:a[0],y1:a[1],x2:b[0],y2:b[1],stroke:color,'stroke-width':id===selected?5:3,'vector-effect':'non-scaling-stroke'})) node.setAttribute(k,v);
      if(id)node.dataset.wallId=id;
      svg.append(node);
    }
    function dot(p, color) {
      const node = document.createElementNS(svg.namespaceURI, 'circle');
      for (const [k,v] of Object.entries({cx:p[0],cy:p[1],r:radius,fill:color,stroke:'white','stroke-width':1,'vector-effect':'non-scaling-stroke'})) node.setAttribute(k,v);
      svg.append(node);
    }
    for (const w of p.sourceWalls) { const map=analyses.get(current)?.wallMap.find(m=>m.wallId===w.id);const origin=map&&analyses.get(current).result.walls.find(a=>a.id===map.analysisId);line(w.start,w.end,w.id===selected?'#175dc0':origin?(origin.confidence===.4?'#b86612':'#7937b3'):'#156a4b',w.id); if(w.id===selected){dot(w.start,'#175dc0');dot(w.end,'#175dc0');} }
    const reference = shapeEditor?.tool!=='navigate' ? [] : points.length ? points : ($('traceMode').value==='calibrate' ? p.calibration?.sourcePoints || [] : []);
    if(reference.length===2)line(...reference,'#c16a13');
    reference.forEach((p,i)=>{dot(p,'#c16a13');const label=document.createElementNS(svg.namespaceURI,'text');label.setAttribute('x',p[0]+radius*1.5);label.setAttribute('y',p[1]-radius);label.setAttribute('font-size',radius*3);label.setAttribute('fill','#934600');label.textContent=i?'終点':'始点';svg.append(label);});
    if(points.length===1&&hover){line(points[0],hover,'#156a4b');dot(hover,'#156a4b');}
    shapeEditor?.sync();

  }
  svg.addEventListener('pointerdown', event => event.stopPropagation());
  function inputPoint(event){const p=page();if(!p)return null;const rect=svg.getBoundingClientRect(),raw=sourcePointFromClient([event.clientX,event.clientY],rect,p.sourceSize);if(!raw)return null;return ['wall','edit'].includes($('traceMode').value)?assistedPoint(raw,p,rect,{anchor:points[0],snap:$('traceSnap').checked,axis:$('traceAxis').checked,disabled:event.altKey}):raw;}
  svg.addEventListener('pointermove',event=>{if(shapeEditor?.tool==='navigate'&&$('traceMode').value==='wall'&&points.length===1){hover=inputPoint(event);syncOverlay();}});
  svg.addEventListener('pointerleave',()=>{hover=null;syncOverlay();});
  svg.addEventListener('keydown',event=>{if(event.key==='Escape'){clearPending();syncOverlay();report('入力中の点だけを取り消しました。登録済みの壁は保持しています。');}else if(event.key==='Delete'&&selected){event.preventDefault();$('traceDelete').click();}});
  svg.addEventListener('click', event => attempt(() => {
    if(shapeEditor&&shapeEditor.tool!=='navigate')return;
    svg.focus({preventScroll:true});
    const p = page(); if(!p)return;
    const position = inputPoint(event);
    if(!position)return;
    const region=workspaces.active()?.region;
    if(region&&(position[0]/p.sourceSize[0]<region[0]||position[0]/p.sourceSize[0]>region[0]+region[2]||position[1]/p.sourceSize[1]<region[1]||position[1]/p.sourceSize[1]>region[1]+region[3])){report('この階の解析範囲内で入力してください。');return;}
    const mode = $('traceMode').value;
    if(mode==='calibrate' || mode==='wall') {
      if(points.length===2)points=[];
      points.push(position);
      if(points.length===2 && mode==='wall') {
        const next=addTraceWall(p,...points,Number($('traceHeight').value),Number($('traceThickness').value));
        selected=next.sourceWalls.at(-1).id;clearPending();changed(next,'壁を登録しました。縮尺設定済みの場合は3Dにも反映しました。');
      } else {syncOverlay();report(points.length===1?'1点目を指定しました。2点目をクリックしてください。':'2点を指定しました。実距離を入力し「縮尺を設定」を押してください。');}
    } else if(mode==='edit') {
      if(relocating) {
        const next=updateTraceWall(p,selected,{[relocating]:position});clearPending();changed(next,'壁の端点を更新しました。縮尺設定済みの場合は3Dにも反映します。');
      } else {
        selected=event.target.dataset.wallId || '';
        refresh();report(selected?'壁を選択しました。端点の置き直し・寸法変更・削除ができます。':'線をクリックするか、登録した壁の一覧から選択してください。');
      }
    }
  }));
  function changeMode(mode){shapeEditor?.deactivate();$('traceMode').value=mode;clearPending();if(mode!=='navigate')showPlanTab();refresh();report(mode==='wall'?'壁を描く：始点と終点をクリック。緑の線が登録され、3Dも更新されます。':mode==='edit'?'壁をクリックして選び、端点修正・高さ変更・削除ができます。':'閲覧：ドラッグで移動できます。拡大縮小ボタンはどのモードでも使えます。');}
  $('traceMode').addEventListener('change',()=>changeMode($('traceMode').value));
  for(const[id,mode]of[['traceBrowse','navigate'],['traceDraw','wall'],['traceEdit','edit']])$(id).addEventListener('click',()=>changeMode(mode));
  $('traceCancelPoint').addEventListener('click',()=>{clearPending();syncOverlay();report('入力中の点を取り消しました。登録済みの壁は保持しています。');});
  $('traceEstimate').addEventListener('click',()=>attempt(()=>{const floor=workspaces.active();if(!floor)throw new Error('最初に階の範囲を登録してください。');if(page().calibration&&!floor.assumedScale&&!analyses.get(current)?.assumedScale)throw new Error('設定済みの実距離は変更しません。現在の縮尺で壁を描けます。');const next=estimatedFloorCalibration(page(),floor.region);floor.assumedScale=true;clearPending();changed(next,'この階の横幅10mの仮寸法で始めます。必要なら実距離で設定し直してください。');changeMode('wall');}));
  $('traceCalibrate').addEventListener('click',()=>attempt(()=>{
    if(points.length===1)throw new Error('縮尺の2点目を指定してください。');
    const reference=points.length===2?points:page()?.calibration?.sourcePoints;
    if(!reference)throw new Error('縮尺モードで図面上の2点を指定してください。');
    const next=calibrateTrace(page(),...reference,Number($('traceDistance').value));
    if(analyses.has(current))analyses.get(current).assumedScale=false;if(workspaces.active())workspaces.active().assumedScale=false;
    clearPending();changed(next,'このページの縮尺を設定しました。登録済みの壁も新しい縮尺で更新しました。');
  }));
  $('traceWall').addEventListener('change',()=>{selected=$('traceWall').value;clearPending();selectedFields();syncOverlay();});
  for(const [id,key] of [['traceStart','start'],['traceEnd','end']]) $(id).addEventListener('click',()=>{
    $('traceMode').value='edit';points=[];relocating=key;showPlanTab();refresh();report(`${key==='start'?'始点':'終点'}の新しい位置を図面上でクリックしてください。`);
  });
  $('traceDimensions').addEventListener('click',()=>attempt(()=>changed(updateTraceWall(page(),selected,{height:Number($('traceHeight').value),thickness:Number($('traceThickness').value)}),'選択壁の高さ・厚みを更新しました。')));
  $('traceDelete').addEventListener('click',()=>attempt(()=>{
    const next=deleteTraceWall(page(),selected);selected='';clearPending();changed(next,'壁を削除しました。縮尺設定済みの場合は3Dにも反映します。');
  }));
  $('traceShow3D').addEventListener('click',()=>{publish(true);});
  shapeEditor=mountShapeEditor(host,{svg,getPage:page,getRegion:()=>workspaces.active()?.region,getElement,commit:changed,setMode:(mode,show=true)=>{ $('traceMode').value=mode;clearPending();if(mode!=='navigate'&&show)showPlanTab();refresh();},report,undo,getStairRect:()=>{if(stairDraft?.floorId===workspaces.activeId){const r=structuredClone(stairDraft.rect);r.direction=stairDraft.direction;r.steps=Math.ceil(((page()?.sourceWalls.length?Math.max(...page().sourceWalls.map(w=>w.height)):2.7)+ensureBuilding(building,workspaces.floors).floorThickness)/.2);return r;}const f=workspaces.active(),config=ensureBuilding(building,workspaces.floors),stair=config.stairs?.[0];if(!f||stair?.fromFloorId!==f.id)return null;const state=workspaces.save(snapshot()),layout=createBuildingLayout(state.floors,config),hole=layout.stairInfo?.[0]?.opening,p=page();if(!hole||!p?.calibration)return null;const origin=[0,1].map(i=>Math.min(...p.sourceWalls.flatMap(w=>[w.start[i],w.end[i]]))),scale=p.calibration.metres/Math.hypot(p.calibration.sourcePoints[1][0]-p.calibration.sourcePoints[0][0],p.calibration.sourcePoints[1][1]-p.calibration.sourcePoints[0][1]),offset=config.levels.find(l=>l.floorId===f.id).offset;const result=[hole.min,hole.max].map(a=>a.map((v,i)=>(v-offset[i])/scale+origin[i]));result.direction=stair.direction;result.steps=layout.stairInfo[0].count;return result;},onStair:(a,b,previousDirection)=>{const f=workspaces.active();if(!f||!workspaces.floors[workspaces.floors.indexOf(f)+1])throw new Error('階の指定が不適切です。上階が登録された下階（1階）を選んでください。');stairDraft={floorId:f.id,rect:[[Math.min(a[0],b[0]),Math.min(a[1],b[1])],[Math.max(a[0],b[0]),Math.max(a[1],b[1])]],direction:previousDirection??(Math.abs(b[0]-a[0])>Math.abs(b[1]-a[1])?0:90)};refresh();report('範囲を指定しました。右の③上り方向を選び、④3Dに反映を押してください。');}});
  refresh();
  return {
    placeStair(fromId){const f=workspaces.floors.find(f=>f.id===fromId);if(!f||!workspaces.floors[workspaces.floors.indexOf(f)+1])throw new Error('接続する上階がありません。先に1階と2階を登録してください。');if(workspaces.activeId!==fromId)loadWorkspace(workspaces.activate(fromId,snapshot()));shapeEditor.activate('stair');},
    get isNavigating(){return $('traceMode').value==='navigate';}, syncOverlay,
    get canSave(){return current!==null && pages.has(current);},
    subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
    getState(){const state=workspaces.save(snapshot());return {...state,...(building&&state.floors?.length?{building:ensureBuilding(building,state.floors)}:{})};},
    undo,
    setWindow(window,id=null){if(!workspaces.active())throw new Error('作業する階を登録して選択してください。');changed(putWindow(page(),window,id),id?'開口を更新しました。':'開口を追加しました。');},
    deleteWindow(id){changed(removeWindow(page(),id),'開口を削除し壁を復元しました。');},
    getDisplayName(){return buildingView==='all'?'建物全体':(workspaces.floors.find(f=>f.id===buildingView)||workspaces.active())?.name||'全体・手動作業';},
    getBuilding(){const state=workspaces.save(snapshot());return ensureBuilding(building,state.floors||[]);},
    getBuildingView(){return buildingView;},
    setBuilding:applyBuilding,
    get isStairPlacing(){return shapeEditor?.tool==='stair';},
    getStairDraft(){return stairDraft?structuredClone(stairDraft):null;},
    beginStair(){if(!workspaces.active()||!workspaces.floors[workspaces.floors.indexOf(workspaces.active())+1])throw new Error('階の指定が不適切です。上階が登録された下階（1階）を選んでください。');shapeEditor.activate('stair');},
    setStairDirection(direction){if(!stairDraft)throw new Error('先に平面図上で四角形の範囲を指定してください。');stairDraft.direction=direction;refresh();},
    cancelStair(){stairDraft=null;refresh();},
    applyStair(strict=false){if(!stairDraft||stairDraft.floorId!==workspaces.activeId)throw new Error('範囲を指定した下階を選んでください。');const f=workspaces.active(),b=ensureBuilding(building,workspaces.floors);b.stairs=[stairFromRectangle(page(),b.levels.find(l=>l.floorId===f.id),workspaces.floors,f.id,...stairDraft.rect,stairDraft.direction,strict)];applyBuilding(b);stairDraft=null;shapeEditor.deactivate();$('traceMode').value='navigate';clearPending();refresh();buildingView='all';publish(true);},
    showBuilding(view){if(view!=='all'&&view!=='active'&&!workspaces.floors.some(f=>f.id===view))throw new Error('表示範囲が不正です。');buildingView=view;refresh();publish(true);},
    setFloorDimensions(height,thickness){if(!page())throw new Error('図面を選択してください。');const next=structuredClone(page());next.sourceWalls.forEach(w=>{w.height=height;w.thickness=thickness;});if(!Number.isFinite(height)||height<=0||height>30||!Number.isFinite(thickness)||thickness<=0||thickness>2)throw new Error('壁高さは0〜30m、厚みは0〜2mの正の値です。');$('traceHeight').value=height;$('traceThickness').value=thickness;changed(next,'この階の壁寸法を更新しました。');},
    unifyFloorScale(){if(building?.stairs?.length)throw new Error('階段を削除してから縮尺を統一してください。');if(!page()?.calibration||!workspaces.active())throw new Error('縮尺を設定した階を選択してください。');workspaces.capture(snapshot());const factor=page().calibration.metres/Math.hypot(...page().calibration.sourcePoints[0].map((n,i)=>n-page().calibration.sourcePoints[1][i]));for(const f of workspaces.floors){const p=f.state.pages[0];if(p.sourceUnit!==page().sourceUnit)throw new Error('座標単位が違う階は個別に縮尺を設定してください。');}for(const f of workspaces.floors){const p=f.state.pages[0];p.calibration={sourcePoints:[[0,0],[p.sourceSize[0],0]],metres:p.sourceSize[0]*factor};f.assumedScale=!!workspaces.active().assumedScale;}histories.clear();stable.clear();loadWorkspace(workspaces.active().state);report('全階で1図面単位あたりの実寸をそろえました。図面ごとに縮尺が違う場合は個別設定してください。');},
    reverseFloors(){if(building?.stairs?.length)throw new Error('階段を削除してから上下順を変更してください。');workspaces.capture(snapshot());workspaces.floors.reverse();refresh();publish();},
    getFloor(){return workspaces.active();},
    getFloors(){return workspaces.floors.map(({id,name,sourcePage,region})=>({id,name,sourcePage,region}));},
    setMode(mode){shapeEditor?.deactivate();$('traceMode').value=mode;clearPending();refresh();},
    addFloor(name,region){
      if(!page())throw new Error('図面を読み込んでください。');
      if(!validRegion(region)||typeof name!=='string'||!name.trim()||name.length>40)throw new Error('階名・解析範囲が不正です。');
      if(workspaces.floors.length>=20)throw new Error('階別作業は20件までです。');
      const base=snapshot(),p=createTracePage(current,page().sourceSize,page().sourceUnit);
      workspaces.add(name,current,region,base);
      loadWorkspace({pages:[p],analyses:[],editor:{...base.editor,selectedWallId:null,mode:'navigate',height:2.7,thickness:.16}});
    },
    renameFloor(name){const f=workspaces.active();if(!f||!name.trim()||name.length>40)throw new Error('階名を入力してください。');f.name=name.trim();refresh();publish();},
    selectFloor(id){buildingView='active';loadWorkspace(workspaces.activate(id,snapshot()));if(page()?.sourceWalls.length)publish(true);},
    getPage(){return page()?JSON.parse(JSON.stringify(page())):null;},
    getAnalysis(){return analyses.get(current)||null;},
    appendAI(result,model){
      if(!page())throw new Error('表示中の図面がありません。');
      let input=page();const floor=workspaces.active();const assumed=!!floor&&!input.calibration;
      if(assumed){const [x,y,w]=floor.region;input=calibrateTrace(input,[x*input.sourceSize[0],y*input.sourceSize[1]],[(x+w)*input.sourceSize[0],y*input.sourceSize[1]],10);}
      const applied=applyAnalysis(input,result,model);if(assumed&&floor)floor.assumedScale=true;if(assumed||floor?.assumedScale)applied.analysis.assumedScale=true;
      analyses.set(current,mergeAnalysis(analyses.get(current),applied.analysis));selected='';clearPending();
      changed(applied.page,applied.analysis.assumedScale?'AI推定の仮寸法です。横幅10m・壁高2.7mとして表示しています。縮尺を設定して修正できます。':'AIの壁を追加しました。現在の縮尺で表示します。');
      publish(true);
    },
    restoreProject(project){
      const checked=validateTraceProject(project);
      if(!checked.valid)throw new Error(checked.errors.map(e=>e.message).join('\n'));
      stairDraft=null;histories.clear();stable.clear();building=project.building||null;buildingView='active';const state=workspaces.restore(project);loadWorkspace(state);resumeEditor=state.editor;
    },
    setPage(number, size, unit) {
      if(number!==null&&workspaces.active()&&number!==workspaces.active().sourcePage)loadWorkspace(workspaces.activate(null,snapshot()));
      clearPending();selected='';current=number;
      if(number!==null&&!pages.has(number))pages.set(number,createTracePage(number,size,unit));
      $('traceDistance').value=page()?.calibration?.metres ?? '';
      if(resumeEditor && number===resumeEditor.page){
        selected=resumeEditor.selectedWallId||'';$('traceMode').value=resumeEditor.mode;
      }
      refresh();
      if(resumeEditor && number===resumeEditor.page){
        $('traceHeight').value=resumeEditor.height;$('traceThickness').value=resumeEditor.thickness;resumeEditor=null;
      }
      publish();report(page()?(analyses.get(current)?.assumedScale?'AI推定の仮縮尺です（図面横幅10m）。実寸ではありません。':'このページの縮尺と壁を編集中です。'):'ページの描画中は壁を入力できません。');
    },
    reset(){stairDraft=null;building=null;buildingView='active';histories.clear();stable.clear();shapeEditor?.deactivate();workspaces.base=null;workspaces.floors=[];workspaces.activeId=null;analyses.clear();resumeEditor=null;pages.clear();current=null;selected='';clearPending();$('traceDistance').value='';$('traceMode').value='navigate';refresh();publish();report('図面を読み込み、縮尺を設定してください。');}
  };
}
