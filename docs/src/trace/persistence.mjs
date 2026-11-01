import { MAX_PROJECT_BYTES, parseTraceProject, createTraceProject, serializeTraceProject, compareTraceSource, allTracePages, activeTraceEditor } from './project.mjs';

export function mountTracePersistence(host, { trace, inspectDrawing, activatePage }) {
  host.innerHTML = `<h2 class="section-heading">壁入力の保存・復元</h2>
    <button class="button" id="traceSaveProject" type="button" disabled>作業JSONを保存</button>
    <label for="traceProjectFile" class="hint">保存した作業JSONを読み込む</label>
    <input id="traceProjectFile" type="file" accept=".json,application/json" aria-label="保存した作業JSONを選択" />
    <p class="hint">図面本体・ファイル名は保存しません。復元には元図面を再選択します。JSONには壁・寸法が含まれます。</p>
    <p id="traceProjectSummary" class="hint"></p>
    <button class="button" id="traceRestoreProject" type="button" disabled>復元を適用（現在の入力を置換）</button>
    <button class="button" id="traceCancelRestore" type="button" disabled>復元待ちを取り消す</button>
    <p class="hint">読み込みと検査だけでは現在の入力は変わりません。置換前に現在の作業も保存できます。未確定の点・ズーム・3D視点は保存対象外です。</p>
    <p id="traceProjectResult" class="hint" role="status" aria-live="polite">図面なしでも保存JSONを検査できます。</p>`;
  const $=id=>host.querySelector(`#${id}`);
  const save=$('traceSaveProject'), apply=$('traceRestoreProject'), cancel=$('traceCancelRestore'), input=$('traceProjectFile');
  let pending=null, sourceReady=false, sourceEpoch=0, checkGeneration=0, readGeneration=0, applying=false;
  const report=message=>{$('traceProjectResult').textContent=message;};
  const updateSave=()=>{save.disabled=applying||!sourceReady||!trace.canSave;};
  trace.subscribe(updateSave);
  async function checkSource() {
    const generation=++checkGeneration, candidate=pending;
    apply.disabled=true;sourceReady=false;updateSave();
    try {
      const actual=await inspectDrawing(candidate?allTracePages(candidate).map(p=>p.page):[]);
      if(generation!==checkGeneration)return;
      sourceReady=!!actual;updateSave();
      if(!candidate)return;
      const comparison=compareTraceSource(candidate,actual);
      apply.disabled=applying||!comparison.matches;
      report(comparison.matches?'元図面のファイル指紋・ページ数・寸法が一致しました。「復元を適用」で編集を再開できます。':'復元はまだ適用していません。\n'+comparison.issues.join('\n'));
    } catch {
      if(generation===checkGeneration)report('元図面の対応を確認できませんでした。描画完了後に元の図面を再選択してください。');
    }
  }
  input.addEventListener('change',async()=>{
    const file=input.files[0];input.value='';if(!file)return;
    const reading=++readGeneration;checkGeneration++;pending=null;apply.disabled=true;cancel.disabled=true;
    $('traceProjectSummary').textContent='';
    if(file.size>MAX_PROJECT_BYTES){report('読み込みを中止しました。保存JSONは5MiB以内にしてください。現在の入力は維持します。');return;}
    try {
      const checked=parseTraceProject(await file.text());
      if(reading!==readGeneration)return;
      if(!checked.valid){report('保存JSONを拒否しました。現在の入力は維持します。\n'+checked.errors.map(e=>`${e.path}: ${e.message}`).join('\n'));return;}
      pending=checked.data;cancel.disabled=false;
      $('traceProjectSummary').textContent=`形式v${pending.schemaVersion} / ${new Set(allTracePages(pending).map(p=>p.page)).size}ページ・${pending.floors?.length||0}階 / 壁${allTracePages(pending).reduce((n,p)=>n+p.sourceWalls.length,0)}件 / 再開ページ${pending.editor.page}`;
      report('保存JSONの検査が完了しました。元の図面を照合しています。');
      await checkSource();
    } catch {if(reading===readGeneration)report('保存JSONを読み取れませんでした。現在の入力は維持します。');}
  });
  cancel.addEventListener('click',()=>{
    pending=null;readGeneration++;checkGeneration++;apply.disabled=true;cancel.disabled=true;
    $('traceProjectSummary').textContent='';report('復元待ちを取り消しました。現在の入力は維持しています。');checkSource();
  });
  save.addEventListener('click',async()=>{
    const epoch=sourceEpoch, state=trace.getState();
    if(!trace.canSave)return;
    save.disabled=true;
    try {
      const actual=await inspectDrawing(allTracePages(state).map(p=>p.page));
      if(epoch!==sourceEpoch)throw new Error('図面が変更されました。描画完了後に保存し直してください。');
      if(!actual)throw new Error('元図面の確認ができません。描画完了後に再試行してください。');
      const project=createTraceProject(actual.source,state);
      const comparison=compareTraceSource(project,actual);
      if(!comparison.matches)throw new Error(comparison.issues.join('\n'));
      const text=serializeTraceProject(project);
      const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download=`ai-house-tracing.v${project.schemaVersion}.json`;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      report('作業JSONをダウンロードしました。全保存ページの縮尺・壁・編集状態を記録しました。元図面は含みません。');
    } catch(error){report('保存できませんでした。\n'+error.message);}
    finally{updateSave();}
  });
  apply.addEventListener('click',async()=>{
    if(!pending||applying)return;
    const candidate=pending, epoch=sourceEpoch;
    applying=true;apply.disabled=true;cancel.disabled=true;input.disabled=true;updateSave();
    try {
      // Recheck immediately before replacing, even if the earlier check succeeded.
      const actual=await inspectDrawing(allTracePages(candidate).map(p=>p.page));
      if(epoch!==sourceEpoch||candidate!==pending)return;
      const comparison=compareTraceSource(candidate,actual);
      if(!comparison.matches)throw new Error(comparison.issues.join('\n'));
      trace.restoreProject(candidate);
      const visible=await activatePage(activeTraceEditor(candidate).page);
      if(epoch!==sourceEpoch)return;
      pending=null;$('traceProjectSummary').textContent='';
      report(visible?'作業を復元しました。縮尺・壁・選択・入力寸法を復元し、編集を続けられます。':'データは復元しましたがページを描画できませんでした。ページを切り替えて再表示してください。');
    } catch(error){report('復元を中止しました。\n'+error.message);}
    finally{applying=false;input.disabled=false;cancel.disabled=!pending;updateSave();if(pending)await checkSource();}
  });
  return {
    drawingChanged(){sourceEpoch++;sourceReady=false;updateSave();return checkSource();},
  };
}
