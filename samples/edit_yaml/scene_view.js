// scene_view.js 2026/09/18
// 編集画面のPBR表示。保存するrenderer設定とは独立した照明で形状を確認する
import { createWebgSceneApp } from "../../webg/app/index.js";
import { createPrimitiveScene, readPrimitiveMaterialManifest } from "../../webg/app/PrimitiveScene.js";
import { viewProjection, screenRay, pickMesh, projectPoint } from "../karakuri/editor_projection.js";
import { colliderLines } from "./collider_edit.js";

// GPUの初期化は一度だけ行い、以後は編集されたNodeだけを作り直す
export async function createView(onSelect, onError, onVertex) {
  let scene = null, selection = null, markers = [];
  let showCollider = true;
  const overlay = document.createElement("canvas");
  overlay.width = 960; overlay.height = 640;
  overlay.className = "selection-overlay";
  document.querySelector(".view").append(overlay);
  // 頂点は透過選択として描き、選択面を淡い色で重ねて面番号との対応を示す
  function drawSelection() {
    const ctx = overlay.getContext("2d"); ctx.clearRect(0,0,960,640); markers = [];
    const entry = scene?.entries.find(item => item.id === selection?.id);
    if (!entry) return;
    const matrix = entry.node.getWorldMatrix(), vp = viewProjection(runtime.app);
    // 衝突形状は黄色の透過線で表示する。奥の辺も描き、接触計算用の輪郭を確認する
    if (showCollider && entry.physics) {
      ctx.strokeStyle="#ffe06a";ctx.lineWidth=2;
      for(const [a,b] of colliderLines(entry.physics.shape)) {
        const p=projectPoint(vp,matrix.mulVector(a),960,640),q=projectPoint(vp,matrix.mulVector(b),960,640);
        if(!p||!q)continue;
        ctx.beginPath();ctx.moveTo(p.left,640-p.bottom);ctx.lineTo(q.left,640-q.bottom);ctx.stroke();
      }
      ctx.lineWidth=1;
    }
    if (!selection.mesh) return;
    markers = selection.mesh.vertices.map(v => projectPoint(vp, matrix.mulVector(v),960,640));
    const face = selection.mesh.faces[selection.face];
    if (face && face.every(i=>markers[i])) {
      ctx.beginPath(); face.forEach((i,j)=>{const p=markers[i]; if(j===0)ctx.moveTo(p.left,640-p.bottom);else ctx.lineTo(p.left,640-p.bottom);});ctx.closePath();ctx.fillStyle="#ffb74d55";ctx.fill();ctx.strokeStyle="#ffc572";ctx.stroke();
    }
    markers.forEach((p,i)=>{if(!p)return;ctx.beginPath();ctx.arc(p.left,640-p.bottom,i===selection.vertex?6:3,0,Math.PI*2);ctx.fillStyle=i===selection.vertex?"#ffb74d":"#7dfff0";ctx.fill();if(i===selection.vertex){ctx.font="16px sans-serif";ctx.fillText(String(i),p.left+8,640-p.bottom-8);}});
  }
  const runtime = await createWebgSceneApp({
    project: { format: "webg-scene", version: 1, name: "editor-preview", renderer: { profile: "studio", width: 960, height: 640, environment: { preset: "dark-studio", resolution: { width: 128, height: 64 } } } },
    physics: false, renderMode: "ondemand",
    camera: { target: [0, 1, 0], distance: 12, yaw: 25, pitch: -20 },
    createScene: () => ({ nodes: new Map(), getNode: id => scene?.nodes.get(id) }), onError,
    onPresented: drawSelection
  });
  const app = runtime.app;
  // 親Nodeを削除すると子も破棄されるため、最上位だけを削除対象にする
  function remove(value) {
    if (value) for (const entry of value.entries) if (entry.parent === undefined) app.space.removeNodeTree(entry.node, { destroyShapes: true });
  }
  // primitiveとメッシュを同じコア経路で構築し、成功後に旧表示を破棄する
  function rebuild(document) {
    let next = null;
    try {
      const { core, meshes } = document.checked;
      if (!document.checked.entries.length) next = { entries: [], nodes: new Map() };
      else next = createPrimitiveScene(app, core.objects, "editor", core.materials ? readPrimitiveMaterialManifest(core.materials) : null, core.objectSets, { orientationFormat: "euler", meshDefinitions: meshes });
    } catch (error) { remove(next); throw error; }
    remove(scene); scene = next; app.requestRender();
  }
  let down = null;
  const canvas = document.getElementById("canvas");
  // カメラ回転とクリック選択を区別し、表示メッシュとの交差で最前面を選ぶ
  canvas.addEventListener("pointerdown", event => { down = [event.clientX, event.clientY]; });
  canvas.addEventListener("pointerup", event => {
    if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return;
    const rect = canvas.getBoundingClientRect();
    const x=(event.clientX-rect.left)/rect.width*960, y=(event.clientY-rect.top)/rect.height*640;
    const near=markers.map((p,i)=>({i,d:p?Math.hypot(p.left-x,640-p.bottom-y):Infinity})).filter(p=>p.d<12).sort((a,b)=>a.d-b.d)[0];
    if(near){onVertex(near.i);down=null;return;}
    const hit = pickMesh(scene?.entries ?? [], screenRay(viewProjection(app), (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height));
    if (hit) onSelect(hit.id);
    down = null;
  });
  runtime.start();
  return { rebuild, runtime, select(value) { selection=value; app.requestRender(); }, showCollider(value) { showCollider=value;app.requestRender(); } };
}
