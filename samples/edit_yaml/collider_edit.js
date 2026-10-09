// collider_edit.js 2026/09/18
// 衝突形状の明示的な選択と、確認用の線分生成

// メニューに表示した初期寸法で新しい衝突形状を作る。表示メッシュから寸法を推測しない
export function newCollider(type) {
  if (type === "box") return { type, size: [1, 1, 1] };
  if (type === "sphere") return { type, radius: 0.5 };
  if (type === "capsule") return { type, radius: 0.3, segmentLength: 0.4 };
  throw Error(`未対応の衝突形状: ${type}`);
}

// コアで検証済みの形状をlocal座標の線分へ変換する。offsetは物体の回転前に加える
// 円弧は表示専用に32分割するため、solverへ渡す寸法と分割数は独立している
export function colliderLines(shape) {
  const lines = [], offset = shape.offset ?? [0, 0, 0];
  // 全線分へ同じlocal offsetを加え、Nodeのworld行列で後から配置する
  function line(a, b) { lines.push([a.map((v,i)=>v+offset[i]), b.map((v,i)=>v+offset[i])]); }
  // 指定した平面内の円または半円を連続した線分で描く
  function arc(point, start = 0, end = Math.PI * 2) {
    for (let i=0;i<32;i++) line(point(start+(end-start)*i/32),point(start+(end-start)*(i+1)/32));
  }
  if (shape.type === "box") {
    const vertices=Array.from({length:8},(_,i)=>shape.size.map((s,axis)=>(i&(1<<axis)?1:-1)*s/2));
    vertices.forEach((v,i)=>{for(let axis=0;axis<3;axis++)if(!(i&(1<<axis)))line(v,vertices[i|(1<<axis)]);});
  } else if (shape.type === "sphere") {
    for(let axis=0;axis<3;axis++)arc(t=>{const p=[0,0,0];p[(axis+1)%3]=shape.radius*Math.cos(t);p[(axis+2)%3]=shape.radius*Math.sin(t);return p;});
  } else if (shape.type === "capsule") {
    const r=shape.radius,h=shape.segmentLength/2;
    for(const sign of [-1,1])arc(t=>[r*Math.cos(t),sign*h,r*Math.sin(t)]);
    for(const axis of [0,2]) {
      for(const sign of [-1,1]) {
        arc(t=>{const p=[0,sign*(h+r*Math.sin(t)),0];p[axis]=r*Math.cos(t);return p;},0,Math.PI);
        const a=[0,-h,0],b=[0,h,0];a[axis]=b[axis]=sign*r;line(a,b);
      }
    }
  } else throw Error(`未対応の衝突形状: ${shape.type}`);
  return lines;
}
