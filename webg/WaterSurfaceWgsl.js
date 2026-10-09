// ---------------------------------------------
// WaterSurfaceWgsl.js  2026/10/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 水面の屈折・環境反射と後段用の深度・法線

// 共通の波・G-buffer・PBR BRDFへ続けて使う水面WGSLを生成する
// geometryOnlyでは深度と法線までを更新し、通常variantは屈折・吸収・反射も合成する
export function buildWaterSurfaceWgsl({ geometryOnly = false } = {}) {
  return String.raw`
// common.wgslとG-bufferの共有WGSLに続ける
// 不透明なPBR画像から水中の背景を探し、線形HDRで透過・反射を合成する
struct SurfaceCamera {
  projection : vec4f,
  halfSize : vec4f,
  absorption : vec4f,
  lightDirection : vec4f,
  lightColor : vec4f,
  environment : vec4f,
  rotation : vec4f,
};
@group(0) @binding(1) var sceneTexture : texture_2d<f32>;
@group(0) @binding(2) var sceneDepth : texture_depth_2d;
@group(0) @binding(3) var sceneSampler : sampler;
@group(0) @binding(4) var<storage, read> camera : SurfaceCamera;
@group(0) @binding(5) var outputTexture : texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var normalTexture : texture_2d<f32>;
@group(0) @binding(7) var depthOutput : texture_storage_2d<r32float, write>;
@group(0) @binding(8) var normalOutput : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(9) var specularEnvironment : texture_2d<f32>;
@group(0) @binding(10) var environmentSampler : sampler;

// カメラの右・上・前方向の基底で、view-spaceの方向を水域座標へ変換する
fn viewToWorld(v : vec3f) -> vec3f {
  return params.right.xyz * v.x + params.up.xyz * v.y - params.forward.xyz * v.z;
}

// 水域座標の点からカメラ位置を引き、各カメラ軸への投影でview-space位置を求める
fn worldToView(p : vec3f) -> vec3f {
  let v = p - params.eye.xyz;
  return vec3f(dot(params.right.xyz, v), dot(params.up.xyz, v), -dot(params.forward.xyz, v));
}

// view-spaceの位置を画角と縦横比で射影し、画面textureを採取するUVへ変換する
fn project(p : vec3f) -> vec2f {
  let v = worldToView(p);
  return vec2f(v.x / (-v.z * camera.projection.z * camera.projection.w),
    -v.y / (-v.z * camera.projection.z)) * 0.5 + 0.5;
}

// 解析的な高さと勾配を使うNewton法。波の上下界で反復を制限する
// この例は水面を上から見る場合を対象にし、水中カメラは既存表示を保つ
fn waterHit(ray : vec3f) -> f32 {
  if (ray.y >= -0.01 || params.eye.y <= params.water.x + params.water.y) { return -1.0; }
  let lo = max(0.0, (params.water.x + params.water.y - params.eye.y) / ray.y);
  let hi = (params.water.x - params.water.y - params.eye.y) / ray.y;
  var t = clamp((params.water.x - params.eye.y) / ray.y, lo, hi);
  for (var i = 0; i < 7; i++) {
    let p = params.eye.xyz + t * ray;
    let h = surface(p.xz);
    let slope = ray.y - dot(h.yz, ray.xz);
    if (abs(slope) < 0.001) { break; }
    t = clamp(t - (p.y - h.x) / slope, lo, hi);
  }
  let p = params.eye.xyz + t * ray;
  if (abs(p.y - surface(p.xz).x) > 0.01) { return -1.0; }
  return t;
}

// 屈折した光線を画面内の深度と交差させる
// 画面内の可視深度から交点を探し、探索失敗時は元画素の背景を使う
fn refractedHit(p : vec3f, ray : vec3f, dims : vec2i) -> vec3f {
  let maximum = max(params.water.x * 3.0 + 2.0, 4.0);
  var previous = 0.01;
  for (var i = 0; i < 48; i++) {
    let distance = (f32(i) + 1.0) / 48.0 * maximum;
    let q = p + ray * distance;
    let uv = project(q);
    if (any(uv <= vec2f(0.0)) || any(uv >= vec2f(1.0))) { break; }
    let coord = vec2i(uv * vec2f(dims));
    let depth = textureLoad(sceneDepth, coord, 0);
    if (!isGBufferBackgroundDepth(depth)) {
      let sceneDistance = linearizeGBufferDepth(depth, camera.projection);
      let gap = -worldToView(q).z - sceneDistance;
      if (gap >= 0.0 && gap < maximum / 48.0 * 2.0) {
        var lo = previous;
        var hi = distance;
        for (var step = 0; step < 5; step++) {
          let mid = (lo + hi) * 0.5;
          let point = p + ray * mid;
          let sampleUv = project(point);
          let sampleCoord = clamp(vec2i(sampleUv * vec2f(dims)), vec2i(0), dims - 1);
          let d = textureLoad(sceneDepth, sampleCoord, 0);
          if (d == 0.0 || -worldToView(point).z < linearizeGBufferDepth(d, camera.projection)) {
            lo = mid;
          } else { hi = mid; }
        }
        let hitDistance = (lo + hi) * 0.5;
        return vec3f(project(p + ray * hitDistance), hitDistance);
      }
    }
    previous = distance;
  }
  return vec3f(0.0, 0.0, -1.0);
}

// 現在のPBR環境だけを反射する。環境が無効の場合は反射色を零にする
fn reflectedEnvironment(ray : vec3f) -> vec3f {
  if (camera.environment.x == 0.0) { return vec3f(0.0); }
  let direction = vec3f(camera.rotation.x * ray.x + camera.rotation.y * ray.z,
    ray.y, -camera.rotation.y * ray.x + camera.rotation.x * ray.z);
  let uv = vec2f(atan2(direction.z, direction.x) / 6.2831853 + 0.5,
    acos(clamp(direction.y, -1.0, 1.0)) / 3.14159265);
  let mip = camera.halfSize.z * max(camera.environment.z - 1.0, 0.0);
  return textureSampleLevel(specularEnvironment, environmentSampler, uv, mip).rgb
    * camera.environment.y;
}

// 正のview深度をReverse-Zの値へ変換し、有限遠方・無限遠方の投影に合わせる
fn reverseDepth(viewDepth : f32) -> f32 {
  let n = camera.projection.x;
  let f = camera.projection.y;
  if (f == 0.0) { return n / viewDepth; }
  return (n * f / viewDepth - n) / (f - n);
}

@compute @workgroup_size(8, 8, 1)
// 画素の視線と水面の交点を求め、屈折背景・吸収・反射を色と深度へ合成する
fn main(@builtin(global_invocation_id) id : vec3u) {
  let dims = vec2i(textureDimensions(outputTexture));
  let coord = vec2i(id.xy);
  if (any(coord >= dims)) { return; }
  let original = textureLoad(sceneTexture, coord, 0);
  textureStore(outputTexture, coord, original);
  textureStore(depthOutput, coord, vec4f(textureLoad(sceneDepth, coord, 0)));
  textureStore(normalOutput, coord, textureLoad(normalTexture, coord, 0));
  // 屈折率1かつ吸収係数0の場合は、元画像をそのまま出力する
  if (abs(params.water.w - 1.0) < 0.00001 && all(camera.absorption.xyz == vec3f(0.0))) { return; }
  let uv = (vec2f(coord) + 0.5) / vec2f(dims);
  let ndc = uv * 2.0 - 1.0;
  let viewRay = normalize(vec3f(ndc.x * camera.projection.z * camera.projection.w,
    -ndc.y * camera.projection.z, -1.0));
  let ray = viewToWorld(viewRay);
  let distance = waterHit(ray);
  if (distance < 0.0) { return; }
  let p = params.eye.xyz + distance * ray;
  if (any(abs(p.xz) > camera.halfSize.xy)) { return; }

  // 水面より手前の不透明物体を優先し、その画素の色と深度を保つ
  let depth = textureLoad(sceneDepth, coord, 0);
  if (depth != 0.0) {
    let opaque = reconstructGBufferViewPosition(coord, depth, dims, camera.projection);
    if (length(opaque) < distance - 0.002) { return; }
  }
  let normal = normalAt(p.xz);
  let viewPosition = worldToView(p);
  if (-viewPosition.z < camera.projection.x) { return; }
  textureStore(depthOutput, coord, vec4f(reverseDepth(-viewPosition.z)));
  let viewNormal = vec3f(dot(params.right.xyz, normal), dot(params.up.xyz, normal),
    -dot(params.forward.xyz, normal));
  textureStore(normalOutput, coord, vec4f(viewNormal * 0.5 + 0.5, 1.0));

  ${geometryOnly ? "return;" : ""}
  let refracted = refract(ray, normal, 1.0 / params.water.w);
  let hit = refractedHit(p, refracted, dims);
  var transmitted = original.rgb;
  var path = params.water.x;
  if (hit.z >= 0.0) {
    transmitted = textureSampleLevel(sceneTexture, sceneSampler, hit.xy, 0.0).rgb;
    path = hit.z;
  }
  let attenuation = exp(-camera.absorption.xyz * path);
  let c = clamp(-dot(ray, normal), 0.00001, 1.0);
  let ct = sqrt(max(0.0, 1.0 - (1.0 - c*c) / (params.water.w * params.water.w)));
  let reflectance = fresnel(c, ct, params.water.w);
  let reflected = reflectedEnvironment(reflect(ray, normal));
  // GGX鏡面はPBRと同じBRDFを使い、F0だけを水のIORから求める
  let f0 = pow((params.water.w - 1.0) / (params.water.w + 1.0), 2.0);
  var specular = vec3f(0.0);
  if (params.water.w > 1.00001) {
    specular = pbrEvaluateDirectBrdf(vec3f(0.0), normal, -ray,
    -camera.lightDirection.xyz, 0.0, camera.halfSize.z, vec3f(f0),
    camera.lightColor.xyz * camera.lightDirection.w);
  }
  let color = mix(transmitted * attenuation, reflected, reflectance) + specular;
  textureStore(outputTexture, coord, vec4f(color, original.a));
}
`;
}
