import {cameraPose} from '../building/views.mjs';
import { parseAndValidatePlan } from './validate.mjs';
import { createPlanLayout } from './layout.mjs';
import { buildPlanModel, disposePlanModel } from './render.mjs';

export function mountPlanControls(host, { getRuntime, onModeChange, showModelTab, onTraceStatus=()=>{}, getTraceName=()=>'現在の階' }) {
  host.innerHTML = `<h2 class="section-heading">3Dの表示対象</h2>
    <label for="modelSource">表示する住宅</label>
    <select id="modelSource"><option value="sample">既存のサンプル住宅</option><option value="json" disabled>読み込み済み間取りJSONの住宅</option><option value="trace" disabled>編集中の壁（AI候補／手動）</option></select>
    <p class="hint">平面図画像の自動解析ではありません。1階・矩形のJSONから壁・床を表示します。屋根・壁色・保存は既存サンプル専用です。</p>
    <button class="button" id="loadPlanSample" type="button">2部屋のJSONを読み込む</button>
    <details><summary>JSONを編集する</summary>
      <label for="planJson">間取りJSON（メートル）</label>
      <textarea id="planJson" spellcheck="false" rows="12" style="width:100%;box-sizing:border-box;font:11px monospace"></textarea>
    </details>
    <button class="button" id="applyPlanJson" type="button">JSONを検査して生成</button>
    <p class="hint" id="planResult" role="status" aria-live="polite" style="white-space:pre-line">まだJSONから生成していません。</p>`;
  const select=host.querySelector('#modelSource'), input=host.querySelector('#planJson'), result=host.querySelector('#planResult');
  const load=host.querySelector('#loadPlanSample'), apply=host.querySelector('#applyPlanJson');
  const traceListeners=new Set();
  let currentView='perspective';
  let followTrace=false,pendingTrace=null,traceIssue='',mode='sample', model=null, layout=null, traceModel=null, traceLayout=null, legacyView=null;
  const legacyControls = ['roofType','roofPitch','eaveDepth','roofColor','wallHeight','wallColor','roofToggle','saveButton'];
  function report(text) { result.textContent=text;onTraceStatus(mode==='trace'||followTrace?text:''); }
  function runtime() {
    const r=getRuntime();
    if(!r)report('3D表示の準備ができていません。読み込み完了後に再試行してください。');
    return r;
  }
  function frame(r, top=currentView) {
    currentView=top===true?'top':typeof top==='string'?top:'perspective';
    const activeLayout = mode === 'trace' ? traceLayout : layout;
    const pose=cameraPose(activeLayout.bounds,currentView,r.camera.fov,r.camera.aspect||1),distance=pose.distance,center=new r.THREE.Vector3(...pose.target);
    r.controls.minDistance=Math.max(.5,distance/10);r.controls.maxDistance=distance*4;
    r.camera.far=Math.max(100,distance*10);r.camera.updateProjectionMatrix();
    if(r.scene.fog){r.scene.fog.near=distance*3;r.scene.fog.far=distance*8;}
    r.camera.position.set(...pose.position);
    r.controls.target.copy(center);r.controls.update();
  }
  function setMode(next) {
    const r=runtime();if(!r)return false;
    if(next==='trace'&&!traceModel)report(traceIssue||'この階には表示できる壁がありません。');if(next==='json'&&!model){report('先に間取りJSONを検査して生成してください。');return false;}
    if(next!==mode) {
      if(mode==='sample'&&next!=='sample')legacyView={position:r.camera.position.clone(),target:r.controls.target.clone(),far:r.camera.far,min:r.controls.minDistance,max:r.controls.maxDistance,fog:r.scene.fog?{near:r.scene.fog.near,far:r.scene.fog.far}:null};
      else if(next==='sample'&&legacyView){r.camera.position.copy(legacyView.position);r.controls.target.copy(legacyView.target);r.camera.far=legacyView.far;r.camera.updateProjectionMatrix();r.controls.minDistance=legacyView.min;r.controls.maxDistance=legacyView.max;if(legacyView.fog)Object.assign(r.scene.fog,legacyView.fog);r.controls.update();}
    }
    const changed=next!==mode;mode=next;select.value=mode;
    r.legacy.visible=mode==='sample';if(model)model.group.visible=mode==='json';if(traceModel)traceModel.group.visible=mode==='trace';
    legacyControls.forEach(id=>{document.getElementById(id).disabled=mode!=='sample';});
    if(mode!=='sample'){setLabelsVisible(document.getElementById('labelSwitch').checked);if(changed&&(mode!=='trace'||traceModel))frame(r);}
    onModeChange(mode);traceListeners.forEach(fn=>fn());return true;
  }
  function generate() {
    const r=runtime();if(!r)return;
    if(input.value.length>100000){report('生成を中止しました。JSONは100,000文字以内にしてください。以前の表示を維持します。');return;}
    const parsed=parseAndValidatePlan(input.value);
    const next=parsed.valid?createPlanLayout(parsed.data):parsed;
    if(!next.valid){report('生成を中止しました。以前の表示を維持します。\n'+next.errors.map(e=>`${e.path}: ${e.message}`).join('\n'));return;}
    let built;
    try {built=buildPlanModel(r.THREE,next);}catch{report('3Dの作成に失敗しました。以前の表示を維持します。');return;}
    // Replace only after validation and construction have succeeded.
    const old=model;model=built;layout=next;
    const min=layout.bounds.min,max=layout.bounds.max;
    model.group.position.set(-(min[0]+max[0])/2,-min[1],-(min[2]+max[2])/2);
    r.scene.add(model.group);
    if(old){r.scene.remove(old.group);disposePlanModel(old.group);}
    select.querySelector('option[value="json"]').disabled=false;
    followTrace=false;setMode('json');frame(r);showModelTab();
    report('間取りJSONの住宅を表示しています。\n'+next.warnings.map(w=>w.message).join('\n'));
  }
  load.addEventListener('click',async()=>{
    load.disabled=true;apply.disabled=true;input.disabled=true;
    try{const response=await fetch('./samples/two-room-house.v1.json');if(!response.ok)throw new Error('sample');input.value=await response.text();generate();}
    catch{report('サンプルJSONを読み込めませんでした。ローカルサーバーの接続を確認してください。');}
    finally{load.disabled=false;apply.disabled=false;input.disabled=false;}
  });
  apply.addEventListener('click',generate);
  input.addEventListener('input',()=>report('JSONは未反映です。「JSONを検査して生成」で反映してください。現在の3D表示は以前のデータです。'));
  select.addEventListener('change',()=>{
    followTrace=select.value==='trace';
    if(!setMode(select.value)){select.value=mode;return;}
    showModelTab();
    report(mode==='trace'?(traceIssue||'選択中の作業の壁だけを表示しています。完成した住宅ではありません。'):mode==='sample'?'既存のサンプル住宅を表示しています。JSONの編集内容は生成するまで反映されません。':'前回生成した間取りJSONの住宅を表示しています。\n'+layout.warnings.map(w=>w.message).join('\n'));
  });
  function setLabelsVisible(visible){
    for(const built of [model,traceModel])if(built)built.labels.forEach(label=>{label.visible=visible;});
  }
  function setTraceLayout(next, show=false, activate=false) {
    pendingTrace={next,show,activate};if(activate||show)followTrace=!!next;
    const option=select.querySelector('option[value="trace"]');option.disabled=!next;option.textContent=`${getTraceName()}（編集中の壁）`;
    const r=getRuntime();
    if(!r){traceIssue='3Dライブラリの準備待ちです。壁データは保持しています。';report(traceIssue);return false;}
    if(!next?.valid || !next.boxes.length) {
      if(!next&&mode==='trace')setMode('sample');
      if(traceModel){r.scene.remove(traceModel.group);disposePlanModel(traceModel.group);}
      traceModel=null;traceLayout=null;
      if(next&&(activate||show))setMode('trace');
      option.disabled=!next;traceIssue=next?.errors?.map(e=>e.message).join('\n')||'この階には壁がありません。';report(traceIssue);
      return false;
    }
    let built;
    try{built=buildPlanModel(r.THREE,next);}catch(error){if(activate||show){if(traceModel){r.scene.remove(traceModel.group);disposePlanModel(traceModel.group);}traceModel=null;traceLayout=null;setMode('trace');}traceIssue='壁の3D作成に失敗しました。壁データは保持しています。'+(error?.message||'');report(traceIssue);return false;}
    const min=next.bounds.min,max=next.bounds.max;
    built.group.position.set(-(min[0]+max[0])/2,-min[1],-(min[2]+max[2])/2);
    built.labels.forEach(label=>{label.visible=document.getElementById('labelSwitch').checked;});
    built.group.visible=mode==='trace';r.scene.add(built.group);
    if(traceModel){r.scene.remove(traceModel.group);disposePlanModel(traceModel.group);}
    const reframe=!traceLayout||['min','max'].some(k=>next.bounds[k].some((n,i)=>Math.abs(n-traceLayout.bounds[k][i])>1e-5));
    traceModel=built;traceLayout=next;traceIssue='';traceListeners.forEach(fn=>fn());
    select.querySelector('option[value="trace"]').disabled=false;
    if(activate||show){setMode('trace');if(reframe)frame(r);}
    report(`${getTraceName()}：${next.boxes.length+(next.surfaces?.length||0)}部材（壁${next.wallFrames?.length||next.boxes.filter(b=>b.kind==='wall').length}本・床${new Set(next.boxes.filter(b=>b.kind==='floor').map(b=>b.sourceId)).size}面・階段${new Set(next.boxes.filter(b=>b.kind==='stair').map(b=>b.sourceId)).size}・屋根${next.boxes.filter(b=>b.kind==='roof').length+(next.surfaces?.length||0)}）を3Dへ反映しました。\n${(next.warnings||[]).map(w=>w.message).join('\n')}`);
    if(show){setMode('trace');showModelTab();}
    return true;
  }
  return {get isPlanMode(){return mode!=='sample';}, get mode(){return mode;}, setLabelsVisible, setTraceLayout,
    syncTrace(){if(followTrace&&pendingTrace){const ok=setTraceLayout(pendingTrace.next,false,true);const r=getRuntime();if(ok&&r)frame(r);return ok;}return false;},
    getTraceEditor(){const r=getRuntime();return mode==='trace'&&r&&traceModel?{...r,model:traceModel,layout:traceLayout}:null;},
    getImageRuntime(){const r=getRuntime();return r?{...r,modelGroup:mode==='sample'?r.legacy:mode==='json'?model?.group:traceModel?.group}:null;},
    subscribeTrace(fn){traceListeners.add(fn);return ()=>traceListeners.delete(fn);},
    get traceIssue(){return traceIssue;},
    resetView(top=false){if(mode==='sample')return false;if(mode==='trace'&&!traceModel){report(traceIssue||'この階には表示できる壁がありません。');return true;}const r=runtime();if(r)frame(r,top);return true;}};
}
