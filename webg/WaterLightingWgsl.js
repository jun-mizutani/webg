// ---------------------------------------------
// WaterLightingWgsl.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// PBR直接光の拡散成分だけへ接続する、任意receiver用の投影近似

export const WATER_LIGHTING_BINDINGS = String.raw`
struct CausticReceiverParams {
  // xyz: カメラ相対の照度基準面原点、w: 水域の幅
  origin : vec4f,
  // x: 基準面から平均水面までの高さ、y: 水際の混合幅
  water : vec4f,
};
@group(0) @binding(17) var<storage, read> caustic : CausticReceiverParams;
@group(0) @binding(18) var causticField : texture_2d<f32>;
@group(0) @binding(19) var causticSampler : sampler;
@group(0) @binding(20) var causticReceiverMask : texture_2d<f32>;

// カメラ相対のview-spaceベクトルを回転成分でworld-spaceへ変換する
fn causticWorldVector(v : vec3f) -> vec3f {
  return vec3f(dot(params.viewToWorldRow0.xyz, v),
    dot(params.viewToWorldRow1.xyz, v), dot(params.viewToWorldRow2.xyz, v));
}
`;

export const WATER_LIGHTING_DIFFUSE = String.raw`    let receiverStrength = textureLoad(causticReceiverMask, coord, 0).r;
    let local = causticWorldVector(position) - caustic.origin.xyz;
    // XZと底の範囲だけを先に判定。上端は同じ波から作った高さで判断する
    let inside = all(abs(local.xz) < caustic.water.zw)
      && local.y >= -0.002;
    if (receiverStrength > 0.0 && inside && dot(normal, viewDirection) > 0.0) {
      let sample = textureSampleLevel(causticField, causticSampler,
        local.xz / caustic.origin.w + 0.5, 0.0);
      let received = sample.r;
      // alphaはこのXZでの水面高さ。水面の直下だけ滑らかに混ぜ、
      // 固定の水平しきい値が球の頂部へ輪状の切れ目を作ることを防ぐ
      let submergence = smoothstep(0.0, caustic.water.y, sample.a - local.y);
      let halfVector = normalize(surfaceToLight + viewDirection);
      let f0 = pbrEvaluateF0(albedo.rgb, material.z, vec3f(0.04 * material.x));
      let fresnel = f0 + (vec3f(1.0)-f0)
        * pbrSchlickWeight(max(dot(viewDirection, halfVector), 0.0));
      let diffuseBrdf = (vec3f(1.0)-fresnel) * (1.0-material.z)
        * albedo.rgb / 3.14159265;
      // 画像は水平面照度。上向き法線に対するcosineで傾斜面へ近似する
      // 通常直接光の拡散部分を置き換え、鏡面・IBL・局所光・emissiveを残す
      let cosine = max(causticWorldVector(normal).y, 0.0);
      let ordinaryDiffuse = diffuseBrdf * radiance
        * max(dot(normal, surfaceToLight), 0.0) * shadowVisibility;
      let waterDiffuse = diffuseBrdf * radiance * received * cosine * shadowVisibility;
      lighting += (waterDiffuse - ordinaryDiffuse) * receiverStrength * submergence;
    }`;
