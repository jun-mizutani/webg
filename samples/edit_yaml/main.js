// main.js 2026/09/19
// SceneYAMLの入出力とフォーム編集。Copyright (c) 2026 Jun Mizutani, MIT
import util from "../../webg/util.js";
import { compressSceneYAML } from "../../webg/app/index.js";
import { EditorDocument, initialManifest, serialize } from "./scene_document.js";
import { makeMesh, extrudeFace, subdivideFace } from "./mesh_edit.js";
import { createView } from "./scene_view.js";
import { newCollider } from "./collider_edit.js";

const $ = id => document.getElementById(id);
let state = new EditorDocument(serialize(initialManifest())), selected = "box", view;
let vertexIndex = 0, faceIndex = 0;
let showCollider = true;

// 操作結果と検証エラーを同じ場所へ表示し、エラーを隠さず利用者へ伝える
function status(message, error = false) { $("status").textContent = message; $("status").classList.toggle("error", error); }
// イベントの例外を捕捉し、失敗した操作が完了したように表示されることを防ぐ
function action(id, callback) { $(id).onclick = async () => { try { await callback(); } catch (error) { status(error.message, true); } }; }
// 空文字を0へ変換せず、既存の数値検証関数で入力値を確認する
function number(input) { if (!input.value.trim()) throw Error("数値を入力してください"); return util.readFiniteNumber(Number(input.value), input.name || "入力値"); }
// YAML欄の未反映入力がある間は別の編集で上書きしない
function objectDraft() { const obj=state.manifest.objects.find(item=>item.id===selected); return $("objectSource").value !== (obj?JSON.stringify(obj,null,2):""); }
// 二つの直接入力欄の未確定変更を検出し、別の編集による消失を防ぐ
function requireApplied(ignoreObject = false) { if ($("source").value !== state.text) throw Error("先にYAML欄の入力を反映するか、入力を破棄してください"); if(!ignoreObject && objectDraft())throw Error("先に物体JSONを反映するか、入力を破棄してください"); }
// 表示を先に構築し、成功したときだけ文書と履歴を更新する
function install(text, history = true, rebuildForm = true) {
  const candidate = new EditorDocument(text);
  view.rebuild(candidate);
  if (history) state.commit(text); else state.install(text);
  if (rebuildForm) refresh();
  else {
    // 数値編集中はDOMを維持し、キャレット・フォーカス・スピン操作を継続する
    $("source").value=state.text;
    const obj=object();
    $("objectSource").value=JSON.stringify(obj,null,2);
    $("undo").disabled=!state.undoStack.length;$("redo").disabled=!state.redoStack.length;
    view.select({id:selected,mesh:obj.mesh?state.checked.meshes.get(obj.mesh):undefined,vertex:vertexIndex,face:faceIndex});
  }
  status("反映しました。" + (state.dirty ? "未保存の変更があります" : ""));
}
// フォーム編集の原子単位として、複製したデータを検証してから確定する
function edit(callback, ignoreObject = false, rebuildForm = true) { requireApplied(ignoreObject); const next = structuredClone(state.manifest); callback(next); install(serialize(next, state.sourceDocument),true,rebuildForm); }
// IDの衝突を避け、新しい物体・メッシュ・材質へ独立した名前を割り当てる
function unique(prefix, values) { let n = 1; while (values.some(item => item.id === `${prefix}${n}`)) n++; return `${prefix}${n}`; }
// 選択物体を取得し、生成物体のフォーム編集を明示的に拒否する
function object(manifest = state.manifest) { const value = manifest.objects.find(item => item.id === selected); if (!value) throw Error("objects内の物体を選択してください。生成物体はYAMLで編集します"); return value; }
// 外部文字列はHTMLとして解釈せず、DOMのtextContentで表示する
function element(tag, text, parent) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; parent?.append(node); return node; }
// 数値入力の確定を一回の履歴とし、失敗時は最後に成功した値へ画面を戻す
function numeric(parent, title, value, change) {
  const label = element("label", title, parent), input = element("input", undefined, label);
  input.type = "number"; input.step = "0.01"; input.value = value; input.name = title;
  input.onchange = () => {
    try { const nextValue=number(input);edit(next => change(next,nextValue),false,false);value=nextValue; }
    catch (error) { status(error.message, true); input.value=value; }
  };
}
// 文書から選択一覧、フォーム、原文を再生成する。履歴には画面部品を保存しない
function refresh() {
  $("source").value = state.text; $("objects").replaceChildren(); $("fields").replaceChildren(); $("mesh").replaceChildren();
  $("undo").disabled = !state.undoStack.length; $("redo").disabled = !state.redoStack.length;
  for (const entry of state.checked.entries) {
    const button = element("button", entry.id, $("objects")); button.classList.toggle("selected", selected === entry.id);
    button.onclick = () => { try { requireApplied(); selected = entry.id; vertexIndex = faceIndex = 0; refresh(); } catch (error) { status(error.message, true); } };
  }
  const obj = state.manifest.objects.find(item => item.id === selected);
  $("selection").textContent = obj?.id ?? "物体を選択してください";
  $("objectSource").value = obj ? JSON.stringify(obj, null, 2) : "";
  view?.select(null);
  if (!obj) return;
  view.select({id:obj.id});
  const fields = $("fields"), transform = obj.transform ?? {};
  for (const [key, title, defaults] of [["position", "位置", [0,0,0]], ["orientation", "回転（度）", [0,0,0]]]) {
    let values = transform[key] ?? defaults;
    if (!Array.isArray(values)) values = [values.pitch ?? 0, values.yaw ?? 0, values.roll ?? 0];
    element("p", title + " X / Y / Z", fields); const row = element("div", undefined, fields); row.className = "triple";
    values.forEach((value, axis) => numeric(row, "XYZ"[axis], value, (next, n) => { const t = object(next).transform ??= {}; if(!Array.isArray(t[key]))t[key]=[...values];t[key][axis] = n; }));
  }
  if (obj.shape?.type === "box") obj.shape.size.forEach((value, axis) => numeric(fields, "寸法 " + "XYZ"[axis], value, (next, n) => { object(next).shape.size[axis] = n; }));
  if (obj.shape?.radius !== undefined) numeric(fields, "半径", obj.shape.radius, (next,n) => { object(next).shape.radius = n; });
  if (obj.shape?.segmentLength !== undefined) numeric(fields, "半球間の長さ", obj.shape.segmentLength, (next,n) => { object(next).shape.segmentLength = n; });
  const material = typeof obj.material === "string" ? state.manifest.materials.find(m => m.id === obj.material) : (obj.material ?? {});
  element("p", typeof obj.material === "string" ? `共有材質: ${obj.material}（同じ材質の全物体へ反映）` : "物体の材質", fields);
  for (const [key, defaultValue] of [["metallic",0],["roughness",0.5]]) numeric(fields, key, material[key] ?? defaultValue, (next,n) => { const o = object(next); const m = typeof o.material === "string" ? next.materials.find(m => m.id === o.material) : (o.material ??= {}); m[key] = n; });
  const colorLabel = element("label", "色", fields), color = element("input", undefined, colorLabel); color.type = "color";
  color.value = "#" + (material.color ?? [.8,.8,.8,1]).slice(0,3).map(v => Math.round(v*255).toString(16).padStart(2,"0")).join("");
  color.onchange = () => { try { edit(next => { const o=object(next), m=typeof o.material === "string" ? next.materials.find(m=>m.id===o.material) : (o.material ??= {}); m.color=[1,3,5].map(i=>parseInt(color.value.slice(i,i+2),16)/255).concat(m.color?.[3] ?? 1); }); } catch(error) { status(error.message,true); } };
  const bodyLabel=element("label","物理 bodyType",fields),body=element("select",undefined,bodyLabel);
  for(const type of ["none","static","dynamic","kinematic"]){const option=element("option",type,body);option.value=type;}body.value=obj.physics?.bodyType??"none";
  body.onchange=()=>{try{edit(next=>{const o=object(next);if(body.value==="none")delete o.physics;else {o.physics??={};o.physics.bodyType=body.value;if(body.value==="dynamic")o.physics.mass??=1;}});}catch(error){status(error.message,true);body.value=obj.physics?.bodyType??"none";}};
  if(obj.physics?.bodyType==="dynamic")numeric(fields,"mass",obj.physics.mass,(next,n)=>{object(next).physics.mass=n;});
  if(obj.physics)for(const [key,value] of [["friction",state.manifest.physics?.space?.defaultFriction??.4],["restitution",state.manifest.physics?.space?.defaultRestitution??0]])numeric(fields,key,obj.physics.material?.[key]??value,(next,n)=>{(object(next).physics.material??={})[key]=n;});
  element("p", "物理・階層・詳細材質は下のJSONまたはYAMLで編集します", fields);
  colliderFields(obj, fields);
  meshFields(obj);
}

// 衝突形状の切替と寸法編集を既存の検証・保存・Undoへ接続する
function colliderFields(obj, fields) {
  element("h2","衝突形状",fields);
  const label=element("label","選択物体の衝突形状を黄色の線で表示（奥の辺も表示）",fields);
  const visible=element("input",undefined,label);visible.type="checkbox";visible.checked=showCollider;
  visible.onchange=()=>{showCollider=visible.checked;view.showCollider(showCollider);};
  element("p","種類の変更は下記の初期寸法へ切り替えます。物理なしの物体で選ぶとstaticとして有効になります。",fields);
  const selectLabel=element("label","衝突形状の種類",fields),select=element("select",undefined,selectLabel);
  const options=[["none","物理なし"],["box","Box（1 × 1 × 1）"],["sphere","Sphere（半径0.5）"],["capsule","Capsule（半径0.3・半球間0.4）"]];
  if(obj.shape)options.splice(1,0,["inherit","表示primitiveの寸法を使用"]);
  for(const [value,text] of options){const option=element("option",text,select);option.value=value;}
  const current=obj.physics?(obj.physics.shape?.type??"inherit"):"none";select.value=current;
  select.onchange=()=>{try{edit(next=>{
    const o=object(next),type=select.value;
    if(type==="none"){delete o.physics;return;}
    o.physics??={bodyType:"static"};
    if(type==="inherit")delete o.physics.shape;
    else o.physics.shape=newCollider(type);
  });}catch(error){select.value=current;status(error.message,true);}};
  if(!obj.physics)return;
  if(!obj.physics.shape) {
    const button=element("button","表示形状を独立した衝突形状へコピー",fields);
    button.onclick=()=>{try{edit(next=>{const o=object(next);o.physics.shape=structuredClone(o.shape);});}catch(error){status(error.message,true);}};
    element("p","現在は表示primitiveの寸法に追従します。コピー後は衝突形状を独立して編集できます。",fields);
    return;
  }
  const shape=obj.physics.shape;
  if(shape.type==="box")shape.size.forEach((value,axis)=>numeric(fields,"衝突寸法 "+"XYZ"[axis],value,(next,n)=>{object(next).physics.shape.size[axis]=n;}));
  else numeric(fields,"衝突半径",shape.radius,(next,n)=>{object(next).physics.shape.radius=n;});
  if(shape.type==="capsule")numeric(fields,"衝突の半球間の長さ",shape.segmentLength,(next,n)=>{object(next).physics.shape.segmentLength=n;});
  const offset=shape.offset??[0,0,0];
  offset.forEach((value,axis)=>numeric(fields,"衝突位置 offset "+"XYZ"[axis],value,(next,n)=>{const s=object(next).physics.shape;s.offset??=[...offset];s.offset[axis]=n;}));
  element("p","offsetは物体のlocal座標です。物体や親の回転に合わせて衝突形状も回転します。",fields);
}
// メッシュを頂点番号・面番号で選び、座標移動と面編集を行う
function meshFields(obj) {
  const panel = $("mesh"); element("h2", "メッシュ編集", panel);
  if (!obj.mesh) {
    const button = element("button", "Box / Sphereをメッシュへ変換", panel);
    button.onclick = () => { try { edit(next => {
      const o = object(next);
      if (o.physics && !o.physics.shape) throw Error("変換前に物体JSONのphysics.shapeへ衝突用Box・Sphere・Capsuleを明示してください");
      if (!["box","sphere"].includes(o.shape.type)) throw Error("変換はBoxとSphereに対応しています");
      if (o.shape.offset) throw Error("offset付き形状の変換は未対応です");
      const mesh = makeMesh(o.shape.type === "box" ? "cube" : "sphere");
      mesh.vertices = mesh.vertices.map(v => v.map((n,i) => n * (o.shape.type === "box" ? o.shape.size[i]/2 : o.shape.radius)));
      mesh.id = unique("mesh", next.meshes ?? []); (next.meshes ??= []).push(mesh); o.mesh=mesh.id; delete o.shape;
    }); } catch(error) { status(error.message,true); } }; return;
  }
  const mesh = state.checked.meshes.get(obj.mesh);
  view.select({id:obj.id,mesh,vertex:vertexIndex,face:faceIndex});
  element("p", `${mesh.vertices.length}頂点 / ${mesh.faces.length}面 · 共有mesh: ${mesh.id}`, panel);
  vertexIndex = Math.min(vertexIndex, mesh.vertices.length-1); faceIndex = Math.min(faceIndex, mesh.faces.length-1);
  const vertices = element("select", undefined, panel); vertices.setAttribute("aria-label","頂点番号");
  mesh.vertices.forEach((v,i)=>{ const option=element("option", `${i}: ${v.map(n=>n.toFixed(3)).join(", ")}`,vertices); option.value=i; }); vertices.value=vertexIndex;
  vertices.onchange=()=>{try{requireApplied();vertexIndex=Number(vertices.value); refresh();}catch(error){status(error.message,true);}};
  mesh.vertices[vertexIndex]?.forEach((value,axis)=>numeric(panel,"頂点 " + "XYZ"[axis],value,(next,n)=>{next.meshes.find(m=>m.id===obj.mesh).vertices[vertexIndex][axis]=n;}));
  const faces=element("select",undefined,panel); faces.setAttribute("aria-label","面番号");
  mesh.faces.forEach((face,i)=>{const option=element("option",`${i}: [${face.join(", ")}]`,faces);option.value=i;});faces.value=faceIndex;
  faces.onchange=()=>{faceIndex=Number(faces.value);view.select({id:obj.id,mesh,vertex:vertexIndex,face:faceIndex});};
  const distance=element("input",undefined,panel);distance.type="number";distance.step="any";distance.value="0.25";distance.setAttribute("aria-label","押し出し距離");
  for(const [title,operation] of [["面を押し出す",m=>extrudeFace(m,faceIndex,number(distance))],["面を分割",m=>subdivideFace(m,faceIndex)],["面を削除",m=>{if(faceIndex<0)throw Error("面を選択してください");m.faces.splice(faceIndex,1);}]]) {
    const button=element("button",title,panel);button.onclick=()=>{try{edit(next=>operation(next.meshes.find(m=>m.id===obj.mesh)));}catch(error){status(error.message,true);}};
  }
}
// 保存済みでない作品を破棄する操作には確認を挟む
function confirmReplace() { return (!state.dirty && $("source").value===state.text && !objectDraft()) || confirm("未保存の変更を破棄して置き換えますか？"); }
// 原文またはgzipをローカルへ保存し、外部サーバーへ送信しない
async function save(gzip) {
  requireApplied(); const text=state.text;
  const blob=gzip ? await compressSceneYAML(text) : new Blob([text],{type:"text/yaml;charset=utf-8"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="scene.yaml"+(gzip?".gz":"");a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);state.savedText=text;status("保存ファイルをダウンロードしました");
}
// GPU準備後に操作を接続し、起動中の編集要求を受け付けない
async function start() {
  // フォームのキーはブラウザ標準の入力・Tab移動・矢印増減へ渡す
  // documentへ登録された3D操作用ハンドラには伝えず、preventDefaultは呼ばない
  for (const type of ["keydown","keyup"]) document.querySelector("main").addEventListener(type,event=>{
    if(event.target.closest("input,textarea,select,button,summary"))event.stopPropagation();
  });
  view=await createView(id=>{try{requireApplied();selected=id;refresh();}catch(error){status(error.message,true);}},error=>status(error.message,true),index=>{try{requireApplied();vertexIndex=index;refresh();}catch(error){status(error.message,true);}}); view.rebuild(state);refresh();status("準備できました。フォーム編集ではYAMLを再整形し、コメントを文書先頭へ保持します");
  action("new",()=>{if(confirmReplace()){install(serialize(initialManifest()));selected="box";refresh();}});
  action("open",()=>$("file").click());
  $("file").onchange=async()=>{try{const file=$("file").files[0];if(!file)return;let text;if(file.name.endsWith(".gz"))text=await new Response(file.stream().pipeThrough(new DecompressionStream("gzip"))).text();else text=await file.text();if(!confirmReplace())return;install(text);state.savedText=text;status("読み込みました: "+file.name);}catch(error){status(error.message,true);}finally{$("file").value="";}};
  action("save",()=>save(false));action("gzip",()=>save(true));
  action("applySource",()=>{if(objectDraft())throw Error("先に物体JSONを反映するか、入力を破棄してください");install($("source").value);});action("discard",()=>{refresh();status("入力欄を最後に反映した値へ戻しました");});
  action("applyObject",()=>{const value=JSON.parse($("objectSource").value);edit(next=>{const index=next.objects.findIndex(o=>o.id===selected);if(index<0)throw Error("物体を選択してください");next.objects[index]=value;},true);selected=value.id;refresh();});
  action("undo",()=>{requireApplied();const text=state.undoStack.at(-1),old=state.text;if(text!==undefined){install(text,false);state.undoStack.pop();state.redoStack.push(old);refresh();}});
  action("redo",()=>{requireApplied();const text=state.redoStack.at(-1),old=state.text;if(text!==undefined){install(text,false);state.redoStack.pop();state.undoStack.push(old);refresh();}});
  action("add",()=>{let id;edit(next=>{id=unique("object",state.checked.entries);const kind=$("kind").value;const shape=kind==="box"?{type:kind,size:[1,1,1]}:kind==="sphere"?{type:kind,radius:.5}:{type:kind,radius:.3,segmentLength:1};const material=next.materials?.[0]?.id ?? {color:[.3,.65,.8,1]};next.objects.push({id,shape,transform:{position:[0,1,0]},material});});selected=id;refresh();});
  action("duplicate",()=>{let id;edit(next=>{const copy=structuredClone(object(next));id=unique("object",state.checked.entries);copy.id=id;(copy.transform??={}).position=(copy.transform.position??[0,0,0]).map((n,i)=>n+(i===0?1:0));next.objects.push(copy);});selected=id;refresh();});
  action("delete",()=>edit(next=>{object(next);next.objects=next.objects.filter(o=>o.id!==selected);}));
  window.addEventListener("beforeunload",event=>{if(state.dirty||$("source").value!==state.text||objectDraft()){event.preventDefault();event.returnValue="";}});
}
start().catch(error=>status(error.stack??error.message,true));
