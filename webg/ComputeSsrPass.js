// ---------------------------------------------
// ComputeSsrPass.js  2026/07/23
//   G-buffer screen-space reflection compute pass with roughness pyramid
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
// ComputePassはWGSLからcompute pipelineを構築し、uniformとtextureのbindingを管理するラッパー
import ComputePass from "./ComputePass.js";
import ComputeImagePyramid from "./ComputeImagePyramid.js?v=20260723_image_pyramid";
import { CAMERA_REVERSE_Z } from "./DepthConvention.js";
// GBUFFER_WGSL_COMMONにはdepthの線形化、view-space位置の復元、法線の復号処理が含まれる
import {
  createGBufferProjectionParams,
  GBUFFER_WGSL_COMMON
} from "./GeometryBufferPass.js";
// StorageTargetFactoryはSSR結果を書き込むstorage textureを生成する
// resizeTargetは画面サイズ変更時に出力textureを同じ形式のまま作り直す
import StorageTargetFactory, {
  resizeTarget
} from "./StorageTargetFactory.js";
// utilは外部から渡された値の型、範囲、列挙値を検証するために使用する
import util from "./util.js";

// SSRを生成するとき、個別指定がなければ使用する既定パラメータ
// intensityは反射の合成強度
// distanceはview-spaceにおけるrayの最大探索距離
// thicknessはdepth面を交差とみなす許容厚み
// stepsはcoarse探索で最低限使用する基準step数
// resolutionScaleはSSR出力targetだけを低解像度化する倍率
// reflectivityThresholdは低反射pixelでray marchingを省略する閾値
// enabledは反射生成を行うかどうか
// viewは線形反射またはgeometry情報のデバッグ表示を選択する
export const COMPUTE_SSR_DEFAULTS = Object.freeze({
  intensity: 0.82,
  distance: 42.0,
  thickness: 0.42,
  steps: 48,
  resolutionScale: 0.7,
  reflectivityThreshold: 0.05,
  enabled: true,
  view: "reflection"
});

// SSRはTone Map前のsceneをsampleし、線形High Dynamic Range反射を後段Composerへ渡す
export const COMPUTE_SSR_INPUT_FORMAT = "rgba16float";
export const COMPUTE_SSR_OUTPUT_FORMAT = "rgba16float";
export const COMPUTE_SSR_MATERIAL_FORMAT = "rgba8unorm";
export const COMPUTE_SSR_ROUGHNESS_LEVELS = Object.freeze([2, 4, 8]);

// 呼び出し側が指定できる表示モード
// reflectionは反射成分のみ
// normalはG-buffer法線
// depthは線形化したdepth
export const COMPUTE_SSR_VIEW_MODES = Object.freeze([
  "reflection",
  "normal",
  "depth"
]);

// WGSLで実行するSSR本体
// G-bufferから各pixelの表面位置と法線を復元し、view-spaceで反射rayを進める
// ray上の点をscreenへ投影してdepth bufferと比較し、最初に受理できる交差を反射色として使用する
// Reads the lit High Dynamic Range scene, material, view-space normal, and depth,
// then traces a reflected view-space ray by projecting it back to screen coordinates.
export const COMPUTE_SSR_WGSL = `
// JavaScript側から12個のfloatとして渡されるuniform
// vec4単位にまとめることでuniform bufferのalignmentに合わせる
struct Params {
  // カメラ投影情報
  // xはnear、yはfar、zはtan(verticalFov / 2)、wはaspect
  // projection = near, far, tan(vfov/2), aspect
  projection : vec4f,
  // SSR効果パラメータ
  // xはintensity、yは最大探索距離、zはhit許容厚み、wは基準step数
  // effect = intensity, max distance, hit thickness, base step count
  effect : vec4f,
  // 表示制御用パラメータ
  // xは表示モード、yはreflectivityThreshold、z/wは出力target寸法の確認用予約値
  // control = view mode, reflectivity threshold, output width, output height
  control : vec4f,
};

// G-bufferで共通使用する補助関数をこのshaderへ展開
// このコードでは主にdecodeGBufferNormal、linearizeGBufferDepth、reconstructGBufferViewPositionを使用する
${GBUFFER_WGSL_COMMON}

// binding 0はカメラ情報、SSRパラメータ、表示モードを格納したuniform buffer
// binding 1はDeferred Lighting後の線形High Dynamic Range scene texture
// binding 2は符号化されたview-space法線texture
// binding 3は描画済みgeometryのdepth texture
// binding 4はspecular、roughness、metallic、emissiveを格納したmaterial texture
// binding 5は線形反射色と合成weightを書き込むstorage texture
@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var sceneTexture : texture_2d<f32>;
@group(0) @binding(2) var normalTexture : texture_2d<f32>;
@group(0) @binding(3) var depthTexture : texture_depth_2d;
@group(0) @binding(4) var materialTexture : texture_2d<f32>;
@group(0) @binding(5) var outputTexture : texture_storage_2d<${COMPUTE_SSR_OUTPUT_FORMAT}, write>;

// textureを整数pixel座標で読む前に、座標を有効範囲へ収める
// coordは読み取りたいpixel座標、dimsはtextureの幅と高さ
// 戻り値は0からdims - 1までに制限されたpixel座標
fn clampCoord(coord : vec2<i32>, dims : vec2<i32>) -> vec2<i32> {
  return clamp(coord, vec2<i32>(0), dims - vec2<i32>(1));
}

// view-space上の3D位置を0から1のscreen UV座標へ変換する
// view-spaceはカメラ前方が-Zであるため、正の距離として-position.zを使用する
// params.projection.zとwからvertical FOVおよびaspectを反映する
// Y軸はview-spaceとtexture座標で向きが逆なので符号を反転する
// 戻り値が0から1の範囲外なら、その位置は画面外にある
fn projectToUv(position : vec3f) -> vec2f {
  // zがnear plane付近へ近づいた場合でも0除算しないよう最小値を設ける
  let viewDepth = max(-position.z, 0.0001);
  // perspective除算後の座標をNDCの-1から1の範囲として求める
  let ndc = vec2f(
    position.x / (viewDepth * params.projection.z * params.projection.w),
    -position.y / (viewDepth * params.projection.z)
  );
  // NDCの-1から1をtexture UVの0から1へ変換する
  return ndc * 0.5 + vec2f(0.5);
}

// 指定pixelのG-buffer法線を読み、計算に使用できる向きベクトルへ復号する
// normal texture内の保存形式から共通関数でview-space法線へ戻す
// 戻り値はview-space法線
fn loadNormal(coord : vec2<i32>) -> vec3f {
  return decodeGBufferNormal(textureLoad(normalTexture, coord, 0).rgb);
}

// SSR rayが画面内のgeometryへhitしなかった場合に使用する代替環境色を作る
// direction.yが水平に近いほど明るいhorizon色、上下方向ほど暗い色になる
// 戻り値は反射方向に対応する簡易的な空のRGB
fn environment(direction : vec3f) -> vec3f {
  let horizon = pow(1.0 - abs(direction.y), 3.0);
  return mix(vec3f(0.025, 0.055, 0.09), vec3f(0.16, 0.24, 0.30), horizon);
}

// 8 x 8 pixelを1 workgroupとして実行するcompute shaderの入口
// 1 invocationが出力textureの1 pixelを担当する
// 処理は背景判定、G-buffer復元、ray生成、交差探索、反射合成の順に進む
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  // 段階1: 対象pixelがSSR出力textureの有効範囲内か確認する
  // 出力textureだけを低解像度化できるため、dispatch範囲はoutputTextureの寸法で判定する
  let outputDimsU = textureDimensions(outputTexture);
  if (id.x >= outputDimsU.x || id.y >= outputDimsU.y) {
    return;
  }

  // 段階2: 低解像度出力pixelの中心をfull解像度G-bufferのpixelへ対応付ける
  // outputCoordはstorage textureへの書き込み座標、coordはG-buffer参照用座標として分ける
  let outputCoord = vec2<i32>(id.xy);
  let sourceDimsU = textureDimensions(sceneTexture);
  let dims = vec2<i32>(sourceDimsU);
  let outputDims = vec2<i32>(outputDimsU);
  let sourceUv = (vec2f(outputCoord) + vec2f(0.5)) / vec2f(outputDims);
  let coord = clampCoord(vec2<i32>(sourceUv * vec2f(dims)), dims);
  let depth = textureLoad(depthTexture, coord, 0);
  let mode = i32(round(params.control.x));
  // Reverse-Zのdepthが0ならG-bufferにgeometryがない背景pixelと判断する
  // 背景pixelでは反射寄与なしを表すRGB 0、weight 0を書き込む
  if (isGBufferBackgroundDepth(depth)) {
    textureStore(outputTexture, outputCoord, vec4f(0.0));
    return;
  }

  // 段階3: G-buffer materialとview-space法線を取得する
  // materialはR=specular、G=roughness、B=metallic、A=emissive
  let material = textureLoad(materialTexture, coord, 0);
  let normal = loadNormal(coord);
  // normal表示では-1から1の法線を表示可能な0から1へ変換する
  if (mode == 1) {
    textureStore(outputTexture, outputCoord, vec4f(normal * 0.5 + vec3f(0.5), 1.0));
    return;
  }
  // depth表示ではnearが白、遠方ほど黒へ近づくReverse-Z raw depthを可視化する
  // finite farとinfinite farで同じ意味を保ち、infinite farを有限値へ補正しない
  if (mode == 2) {
    textureStore(outputTexture, outputCoord, vec4f(vec3f(depth), 1.0));
    return;
  }

  // 段階4: 反射の寄与がないpixelではray marchingを省略する
  // enabled=falseではJavaScript側がintensityを0にするため、ここでbaseColorだけを書いて早期終了する
  // reflectivityThresholdは低反射materialの探索を止める閾値で、control.yから受け取る
  let earlyReflectivity = clamp(
    max(material.r, material.b) * params.effect.x,
    0.0,
    1.0
  );
  if (params.effect.x <= 0.00001 || earlyReflectivity <= params.control.y) {
    textureStore(outputTexture, outputCoord, vec4f(0.0));
    return;
  }

  // 段階5: 現在pixelから反射rayを構築する
  // depthとscreen座標から表面のview-space位置を復元する
  let position = reconstructGBufferViewPosition(coord, depth, dims, params.projection);
  // カメラ原点から表面へ向かう正規化ベクトルを入射方向として使用する
  let incident = normalize(position);
  // 入射方向を表面法線で反射し、view-spaceのray進行方向を求める
  let rayDirection = normalize(reflect(incident, normal));
  // UIまたは既定値から最大探索距離、hit厚み、基準step数を取り出す
  let maxDistance = params.effect.y;
  let thickness = params.effect.z;
  let baseStepCount = clamp(i32(round(params.effect.w)), 12, 64);
  // ray開始直後に現在面自身をhitしないよう、表面位置を法線方向へ少し移動する
  // offsetはthicknessの半分または0.05の大きい方
  let rayStart = position + normal * max(thickness * 0.5, 0.05);

  // 段階5: rayがカメラ方向へ進む場合の探索距離をnear plane手前までに制限する
  // rayDirection.zが正ならview-spaceのzが0へ近づく方向
  // near planeを越えると投影座標が不安定になるため1.01倍の位置で停止する
  // The UI distance is an upper bound. Camera-facing rays are clipped before
  // they cross the near plane.
  var usableDistance = maxDistance;
  if (rayDirection.z > 0.00001) {
    usableDistance = min(
      maxDistance,
      (-params.projection.x * 1.01 - rayStart.z) / rayDirection.z
    );
  }

  // 段階6: screen上でのrayの見かけの長さからcoarse step数を動的に決める
  // 初期値にはUIで指定された基準step数を使用する
  var dynamicStepCount = baseStepCount;
  if (usableDistance > 0.0001) {
    // 最大探索位置を求め、rayの始点と終点をpixel座標へ投影する
    let rayEnd = rayStart + rayDirection * usableDistance;
    let startPixel = projectToUv(rayStart) * vec2f(dims);
    let endPixel = projectToUv(rayEnd) * vec2f(dims);
    // X方向とY方向のうち大きい移動量をrayのscreen上の主軸長として使用する
    let pixelDelta = endPixel - startPixel;
    let majorLength = max(abs(pixelDelta.x), abs(pixelDelta.y));

    // coarse探索では約8 pixelごとに1 sampleとなるstep数を目標にする
    // binary searchを5回行うことで、検出したcoarse区間を最大1/32まで狭める
    // 実行時間がrayごとに無制限に増えないようstep数には上限を設ける
    // Five binary-search iterations refine a coarse interval to 1/32, so the
    // coarse pass targets about 8 pixels while staying within a bounded cost.
    let targetCoarsePixels = 8.0;
    // 必要step数を切り上げて求め、基準step数から最大128までの範囲に制限する
    // 上限はbaseStepCountの2倍も超えないため、stepsは最低値と上限の両方へ影響する
    let requestedSteps = i32(ceil(majorLength / targetCoarsePixels));
    dynamicStepCount = clamp(requestedSteps, baseStepCount, min(baseStepCount * 2, 128));
  }

  // 段階7: coarse traversalで使用する状態を初期化する
  // stepLengthはview-spaceで1回進む距離であり、screen上のpixel間隔そのものではない
  let stepLength = max(usableDistance, 0.0001) / f32(dynamicStepCount);
  // previousPositionは直前に調べたray上の位置
  // previousDeltaはray depthからscene depthを引いた値
  // previousValidは直前sampleがnear plane内、画面内、geometry上だったことを示す
  var previousPosition = rayStart;
  var previousDelta = -1.0;
  var previousValid = false;
  // hitするまでは環境色をreflectionの初期値として保持する
  // confidenceは画面端と探索距離から求めるhitの信頼度
  // hitFoundは受理できる最初のhitが決まったことを示す
  var reflection = environment(rayDirection);
  var confidence = 0.0;
  var hitFound = false;

  // 段階8: ray開始位置のdepth差を取得し、最初のcoarse区間を比較可能にする
  // 開始位置がnear planeより奥にあり、画面内かつ背景でない場合だけ有効sampleとする
  if (previousPosition.z < -params.projection.x) {
    // ray開始位置をUVへ投影する
    let startUv = projectToUv(previousPosition);
    if (all(startUv > vec2f(0.001)) && all(startUv < vec2f(0.999))) {
      // UVを整数pixelへ変換し、開始位置に表示されているscene depthを読む
      let startCoord = clampCoord(vec2<i32>(startUv * vec2f(dims)), dims);
      let startDepth = textureLoad(depthTexture, startCoord, 0);
      if (!isGBufferBackgroundDepth(startDepth)) {
        // depth buffer値をview-spaceの正の距離へ線形化する
        // 負ならrayがscene面より手前、正ならscene面より奥にある
        let startSceneDepth = linearizeGBufferDepth(startDepth, params.projection);
        previousDelta = -previousPosition.z - startSceneDepth;
        previousValid = true;
      }
    }
  }

  // 段階9: view-spaceで一定距離ずつrayを進めるcoarse traversal
  // loop上限はshader内で固定し、dynamicStepCountに達した後は処理しない
  // 有効なhitを受理した後も残りiterationの本体には入らない
  // The coarse pass only looks for the first sign-changing interval. The hit
  // color is accepted once after binary refinement.
  for (var i = 0; i < 128; i += 1) {
    if (i < dynamicStepCount && !hitFound) {
      // 直前位置から反射方向へ1 step進め、次のsample位置を求める
      let currentPosition = previousPosition + rayDirection * stepLength;
      // near planeより奥にある位置だけscreenへ投影できるsampleとして扱う
      if (currentPosition.z < -params.projection.x) {
        // 現在sampleのview-space位置をscreen UVへ投影する
        let currentUv = projectToUv(currentPosition);
        // 画面端ぎりぎりを避け、UVが0.001から0.999の範囲にある場合だけdepthを読む
        if (all(currentUv > vec2f(0.001)) && all(currentUv < vec2f(0.999))) {
          // UVを整数pixel座標へ変換し、そのpixelのscene depthを取得する
          let currentCoord = clampCoord(vec2<i32>(currentUv * vec2f(dims)), dims);
          let currentDepth = textureLoad(depthTexture, currentCoord, 0);
          // depthが背景値でなければray depthとの比較が可能
          if (!isGBufferBackgroundDepth(currentDepth)) {
            // ray sampleとscene surfaceのview-space距離差を計算する
            // currentDeltaが負ならrayはsurfaceの手前、0以上なら同じ深さか奥
            let currentSceneDepth = linearizeGBufferDepth(currentDepth, params.projection);
            let currentDelta = -currentPosition.z - currentSceneDepth;

            // 段階10: 手前から奥への符号反転を交差候補区間として検出する
            // 前回sampleが有効で、previousDelta < 0かつcurrentDelta >= 0の場合に成立する
            if (previousValid && previousDelta < 0.0 && currentDelta >= 0.0) {
              // lowPositionをsurface手前側、highPositionをsurface奥側として初期化する
              var lowPosition = previousPosition;
              var highPosition = currentPosition;

              // coarse区間を5回二分し、depth surfaceを横切る位置を細かく絞り込む
              for (var refine = 0; refine < 5; refine += 1) {
                // 現在の手前側と奥側の中点を次の判定位置にする
                let middlePosition = (lowPosition + highPosition) * 0.5;
                // 中点をscreenへ投影し、対応する整数pixelのdepthを読む
                let middleUv = projectToUv(middlePosition);
                let middleCoord = clampCoord(vec2<i32>(middleUv * vec2f(dims)), dims);
                let middleDepth = textureLoad(depthTexture, middleCoord, 0);
                // 中点にgeometryがある場合はrayとsceneのdepth差で区間を更新する
                if (!isGBufferBackgroundDepth(middleDepth)) {
                  let middleSceneDepth = linearizeGBufferDepth(
                    middleDepth,
                    params.projection
                  );
                  // 中点がsurface奥側ならhighを中点へ、手前側ならlowを中点へ移動する
                  let middleDelta = -middlePosition.z - middleSceneDepth;
                  if (middleDelta >= 0.0) {
                    highPosition = middlePosition;
                  } else {
                    lowPosition = middlePosition;
                  }
                } else {
                  // 中点が背景なら比較対象となるsurfaceがないためlow側として先へ進める
                  // depth discontinuityでは厳密な二分探索にならないが、探索を継続できる
                  lowPosition = middlePosition;
                }
              }

              // 段階11: binary search後の奥側境界を最終hit候補として検査する
              let hitUv = projectToUv(highPosition);
              let hitCoord = clampCoord(vec2<i32>(hitUv * vec2f(dims)), dims);
              let hitDepth = textureLoad(depthTexture, hitCoord, 0);
              // hit候補pixelが背景でない場合だけ最終depth差を計算する
              if (!isGBufferBackgroundDepth(hitDepth)) {
                let hitSceneDepth = linearizeGBufferDepth(hitDepth, params.projection);
                let hitDelta = -highPosition.z - hitSceneDepth;
                // rayがsurface奥側にあり、入り込み量がthickness以内ならhitを受理する
                // thicknessが小さいとhit抜けが増え、大きいと誤hitが増える
                if (hitDelta >= 0.0 && hitDelta <= thickness) {
                  // hit位置から上下左右の最も近い画面端までのUV距離を求める
                  let edge = min(
                    min(hitUv.x, hitUv.y),
                    min(1.0 - hitUv.x, 1.0 - hitUv.y)
                  );
                  // 画面端から12パーセント以内では反射を滑らかに弱める
                  let edgeFade = smoothstep(0.0, 0.12, edge);
                  // 元の表面位置からhit候補まで実際に進んだview-space距離を求める
                  let traveled = length(highPosition - position);
                  // 最大探索距離へ近づくほど反射の信頼度を線形に下げる
                  let distanceFade = 1.0 - clamp(traveled / maxDistance, 0.0, 1.0);
                  // hitしたpixelのDeferred Lighting済み線形High Dynamic Range色を取得する
                  reflection = textureLoad(sceneTexture, hitCoord, 0).rgb;
                  // 画面端fadeと距離fadeを掛け合わせて最終confidenceを作る
                  confidence = edgeFade * distanceFade;
                  // 最初に受理されたhitを確定し、以後のcoarse探索を止める
                  hitFound = true;
                }
              }
            }

            // 次のcoarse stepで符号変化を比較できるよう現在値を前回値として保存する
            previousDelta = currentDelta;
            previousValid = true;
          } else {
            // 背景pixelではdepth差を連続比較できないため前回sampleを無効化する
            previousValid = false;
          }
        } else {
          // 画面外へ出た区間をまたいで誤った符号反転を検出しないよう前回sampleを無効化する
          previousValid = false;
        }
      } else {
        // near planeより手前へ出たsampleは投影不能なので前回sampleを無効化する
        previousValid = false;
      }
      // hitの成否にかかわらず、次にrayを進める基準位置を現在sampleへ更新する
      previousPosition = currentPosition;
    }
  }

  // 段階12: 反射の見え方を決めるFresnel、material反射率、confidenceを適用する
  // 視線方向は表面からカメラへ向かうnormalize(-position)
  // 正面視ではfresnelが小さく、斜め視では大きくなる
  let fresnel = pow(1.0 - max(dot(normal, normalize(-position)), 0.0), 5.0);
  // specularまたはmetallicの大きい方を反射率とし、roughnessによる広がりは後段で処理する
  let reflectivity = clamp(
    max(material.r, material.b) * params.effect.x,
    0.0,
    1.0
  );
  // 正面でも反射を完全には消さず55パーセント残し、斜め視で100パーセントへ近づける
  let reflectionWeight = reflectivity * mix(0.55, 1.0, fresnel);
  // confidenceが0でも環境反射を25パーセント残し、hit時は最大100パーセント使用する
  let reflectionOnly = reflection * mix(0.25, 1.0, confidence);

  // RGBにはTone Map前の線形反射色、alphaにはComposer用weightを分けて保存する
  textureStore(outputTexture, outputCoord, vec4f(reflectionOnly, reflectionWeight));
}`;

// SSR ray結果のRGBだけをmaterial roughnessに対応するPyramid Levelから選びます
// Alphaは現在pixelのray結果を保ち、隣接面の反射weightがぼけて流入することを防ぎます
export const COMPUTE_SSR_ROUGHNESS_WGSL = `
struct Params {
  values : vec4f,
};
@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var rawReflectionTexture : texture_2d<f32>;
@group(0) @binding(2) var halfTexture : texture_2d<f32>;
@group(0) @binding(3) var quarterTexture : texture_2d<f32>;
@group(0) @binding(4) var eighthTexture : texture_2d<f32>;
@group(0) @binding(5) var materialTexture : texture_2d<f32>;
@group(0) @binding(6) var levelSampler : sampler;
@group(0) @binding(7) var outputTexture : texture_storage_2d<${COMPUTE_SSR_OUTPUT_FORMAT}, write>;

fn selectReflection(rawColor : vec3f, uv : vec2f, levelPosition : f32) -> vec3f {
  let halfColor = textureSampleLevel(halfTexture, levelSampler, uv, 0.0).rgb;
  let quarterColor = textureSampleLevel(quarterTexture, levelSampler, uv, 0.0).rgb;
  let eighthColor = textureSampleLevel(eighthTexture, levelSampler, uv, 0.0).rgb;
  if (levelPosition < 1.0) {
    return mix(rawColor, halfColor, levelPosition);
  }
  if (levelPosition < 2.0) {
    return mix(halfColor, quarterColor, levelPosition - 1.0);
  }
  return mix(quarterColor, eighthColor, levelPosition - 2.0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let outputDims = textureDimensions(outputTexture);
  if (id.x >= outputDims.x || id.y >= outputDims.y) {
    return;
  }
  let coord = vec2<i32>(id.xy);
  let uv = (vec2f(id.xy) + vec2f(0.5)) / vec2f(outputDims);
  let rawReflection = textureLoad(rawReflectionTexture, coord, 0);
  if (params.values.x < 0.5) {
    textureStore(outputTexture, coord, rawReflection);
    return;
  }
  let materialDims = vec2<i32>(textureDimensions(materialTexture));
  let materialCoord = clamp(
    vec2<i32>(uv * vec2f(materialDims)),
    vec2<i32>(0),
    materialDims - vec2<i32>(1)
  );
  let roughness = clamp(textureLoad(materialTexture, materialCoord, 0).g, 0.0, 1.0);
  let filteredColor = selectReflection(rawReflection.rgb, uv, roughness * 3.0);
  textureStore(outputTexture, coord, vec4f(filteredColor, rawReflection.a));
}`;

// full解像度のG-buffer寸法から、SSR出力target用の低解像度寸法を求める
// 解像度scaleが小さい場合でも1pixel未満にならないよう1以上へ丸める
function scaledSsrSize(value, scale, label) {
  const source = util.readFiniteNumber(value, `${label} source`, {
    integer: true,
    min: 1
  });
  const checkedScale = util.readFiniteNumber(scale, `${label} scale`, {
    min: 0.5,
    max: 1.0
  });
  return Math.max(1, Math.round(source * checkedScale));
}

// G-bufferを入力としてSSR compute passを管理するクラス
// shader本体の生成、入力値の検証、uniform設定、dispatch、出力textureの管理を担当する
export default class ComputeSsrPass {
  /**
   * SSR compute passに必要なGPU資源と出力先を初期化するconstructor
   * gpuはdeviceとqueueを持つ初期化済みWebGPUコンテキスト
   * optionsにはlabel、出力寸法、texture形式、SSR既定パラメータ、targetFactoryを指定できる
   * 不正な設定は初期化時点で例外にし、encode中の曖昧な失敗を避ける
   */
  constructor(gpu, options = {}) {
    // pipelineやtextureを作成する前にWebGPU deviceとqueueの存在を確認する
    if (!gpu?.device || !gpu?.queue) {
      throw new Error("ComputeSsrPass requires a ready WebGPU context");
    }
    // 後続処理と外部から渡されたfactoryで使用するWebGPUコンテキストを保持する
    this.gpu = gpu;
    // デバッグ表示やエラーメッセージに使用する識別名を検証して保存する
    this.label = util.readOptionalString(
      options.label,
      "ComputeSsrPass label",
      "compute-ssr",
      { trim: true, allowEmpty: false }
    );
    // 入力G-bufferのfull解像度を1以上の整数として取得する
    this.fullWidth = util.readOptionalInteger(
      options.width,
      `${this.label} width`,
      1,
      { min: 1 }
    );
    // 入力G-bufferのfull解像度を1以上の整数として取得する
    this.fullHeight = util.readOptionalInteger(
      options.height,
      `${this.label} height`,
      1,
      { min: 1 }
    );
    // SSR出力targetだけを縮小する倍率を保持する
    this.resolutionScale = util.readOptionalFiniteNumber(
      options.resolutionScale,
      `${this.label} resolutionScale`,
      COMPUTE_SSR_DEFAULTS.resolutionScale,
      { min: 0.5, max: 1.0 }
    );
    // 反射率がこの値以下のpixelではray marchingを省略する
    this.reflectivityThreshold = util.readOptionalFiniteNumber(
      options.reflectivityThreshold,
      `${this.label} reflectivityThreshold`,
      COMPUTE_SSR_DEFAULTS.reflectivityThreshold,
      { min: 0.0, max: 1.0 }
    );
    // 出力textureの実寸はfull解像度とresolutionScaleから決める
    this.width = scaledSsrSize(this.fullWidth, this.resolutionScale, `${this.label} width`);
    this.height = scaledSsrSize(this.fullHeight, this.resolutionScale, `${this.label} height`);
    // storage textureの形式を取得し、このpassが対応する既定形式だけを許可する
    this.format = util.readOptionalString(
      options.format,
      `${this.label} format`,
      COMPUTE_SSR_OUTPUT_FORMAT,
      { trim: true, allowEmpty: false }
    );
    // WGSL側のoutputTexture宣言と異なる形式ではpipelineを使用できないため拒否する
    if (this.format !== COMPUTE_SSR_OUTPUT_FORMAT) {
      throw new Error(`${this.label} format must be ${COMPUTE_SSR_OUTPUT_FORMAT}`);
    }
    // constructorで指定されたSSR値または定数の既定値を検証し、instance既定値として保持する
    this.defaults = this.validateParameters({
      intensity: options.intensity ?? COMPUTE_SSR_DEFAULTS.intensity,
      distance: options.distance ?? COMPUTE_SSR_DEFAULTS.distance,
      thickness: options.thickness ?? COMPUTE_SSR_DEFAULTS.thickness,
      steps: options.steps ?? COMPUTE_SSR_DEFAULTS.steps
    });
    // 外部factoryがあれば再利用し、なければこのpass専用のstorage target factoryを作る
    this.targetFactory = options.targetFactory ?? new StorageTargetFactory(gpu, {
      label: `${this.label}:storage`,
      format: this.format
    });
    // factoryが作るtexture形式とshaderが書き込む形式の一致を確認する
    if (this.targetFactory.format !== this.format) {
      throw new Error(
        `${this.label} StorageTargetFactory format must be ${this.format}`
      );
    }
    // ray marching直後の結果とroughness適用後の結果を別targetへ保持する
    this.rayTarget = this.targetFactory.create({
      label: `${this.label}:ray`,
      width: this.width,
      height: this.height,
      format: this.format
    });
    this.outputTarget = this.targetFactory.create({
      label: `${this.label}:output`,
      width: this.width,
      height: this.height,
      format: this.format
    });
    // WGSL、uniformサイズ、各bindingの種類を指定してComputePassを構築する
    // uniformFloats 12はParams内のvec4fが3個であることに対応する
    this.computePass = new ComputePass(gpu, {
      label: this.label,
      code: COMPUTE_SSR_WGSL,
      uniformFloats: 12,
      // shaderのgroup 0へ渡す資源とbinding番号の対応を定義する
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "scene", type: "sampled-texture" },
        { binding: 2, name: "normal", type: "sampled-texture" },
        { binding: 3, name: "depth", type: "depth-texture" },
        { binding: 4, name: "material", type: "sampled-texture" },
        {
          binding: 5,
          name: "output",
          type: "storage-texture",
          format: this.format,
          dispatchSize: true
        }
      ]
    });
    this.roughnessPyramid = new ComputeImagePyramid(gpu, {
      label: `${this.label}:roughness-pyramid`,
      width: this.width,
      height: this.height,
      format: this.format,
      levels: COMPUTE_SSR_ROUGHNESS_LEVELS
    });
    this.roughnessPass = new ComputePass(gpu, {
      label: `${this.label}:roughness-filter`,
      code: COMPUTE_SSR_ROUGHNESS_WGSL,
      uniformFloats: 4,
      bindings: [
        { binding: 0, name: "params", type: "uniform-buffer" },
        { binding: 1, name: "rawReflection", type: "sampled-texture" },
        { binding: 2, name: "half", type: "sampled-texture" },
        { binding: 3, name: "quarter", type: "sampled-texture" },
        { binding: 4, name: "eighth", type: "sampled-texture" },
        { binding: 5, name: "material", type: "sampled-texture" },
        { binding: 6, name: "sampler", type: "sampler" },
        {
          binding: 7,
          name: "output",
          type: "storage-texture",
          format: this.format,
          dispatchSize: true
        }
      ]
    });
    // outputTargetの非同期初期化完了を利用者が待機できるPromiseとして公開する
    this.ready = Promise.all([
      this.rayTarget.ready,
      this.outputTarget.ready,
      this.roughnessPyramid.ready
    ]);
    // destroy済みinstanceの再利用を防ぐ状態flag
    this.destroyed = false;
  }

  /**
   * このinstanceがまだ破棄されていないことを確認する
   * public操作の先頭から呼び、destroy後のGPU資源アクセスを例外にする
   * 戻り値はなく、使用可能ならそのまま処理を継続する
   */
  requireAlive() {
    if (this.destroyed) {
      throw new Error(`${this.label} is destroyed`);
    }
  }

  /**
   * SSRの数値パラメータを検証し、安全な通常objectとして返す
   * intensityは0から1.5、distanceは1以上、thicknessは0より大きい値を許可する
   * stepsはshader側の探索範囲に合わせて12から64の整数だけを許可する
   * @param {object} parameters 検証対象のintensity、distance、thickness、steps
   * @returns {object} 検証済みパラメータ
   */
  validateParameters(parameters) {
    // 配列やclass instanceではないplain objectであることを最初に確認する
    const checked = util.readPlainObject(parameters, `${this.label} parameters`);
    // 各値を有限数として読み、SSR実装が前提とする範囲へ制限する
    return {
      intensity: util.readFiniteNumber(checked.intensity, `${this.label} intensity`, {
        min: 0,
        max: 1.5
      }),
      distance: util.readFiniteNumber(checked.distance, `${this.label} distance`, {
        min: 1
      }),
      thickness: util.readFiniteNumber(checked.thickness, `${this.label} thickness`, {
        minExclusive: 0
      }),
      steps: util.readFiniteNumber(checked.steps, `${this.label} steps`, {
        integer: true,
        min: 12,
        max: 64
      })
    };
  }

  /**
   * SSRの実行解像度と低反射pixelの早期return閾値を検証する
   * resolutionScaleは0.5から1.0までを許可し、SSR出力targetだけを縮小する
   * reflectivityThresholdはmaterial反射率とintensityを掛けた値に対する閾値
   * @param {object} options 実行時option
   * @returns {object} 検証済みのresolutionScaleとreflectivityThreshold
   */
  validatePerformanceOptions(options = {}) {
    return {
      resolutionScale: util.readOptionalFiniteNumber(
        options.resolutionScale,
        `${this.label} resolutionScale`,
        this.resolutionScale,
        { min: 0.5, max: 1.0 }
      ),
      reflectivityThreshold: util.readOptionalFiniteNumber(
        options.reflectivityThreshold,
        `${this.label} reflectivityThreshold`,
        this.reflectivityThreshold,
        { min: 0.0, max: 1.0 }
      )
    };
  }

  /**
   * G-bufferを生成したCamera Frameから共通projection paramを作る
   * 個別配列の入力を廃止し、通常Zや別frameの投影値が混ざる状態を入力時点で止める
   * @param {CameraFrame} cameraFrame 同じ描画frameでGeometry Bufferが使用したCamera Frame
   * @returns {Float32Array} near、farまたは0 sentinel、tan(verticalFov / 2)、aspect
   */
  validateCameraFrame(cameraFrame) {
    return createGBufferProjectionParams(cameraFrame);
  }

  /**
   * encode時に渡されたG-buffer資源がSSRで使用可能か確認する
   * scene、normal、depth、materialの各targetを取り出す
   * sceneの寸法をfull解像度として記録し、SSR出力targetはresolutionScaleで別寸法にできる
   * @param {object} resources G-buffer targetを格納したobject
   * @returns {object} scene、normal、depth、materialを持つ検証済みobject
   */
  validateResources(resources) {
    // resourcesがplain objectであることを確認する
    const checked = util.readPlainObject(resources, `${this.label} resources`);
    const scene = checked.scene;
    const normal = checked.normal;
    const depth = checked.depth;
    const material = checked.material;
    // hit位置の線形照明色を提供できるHigh Dynamic Range scene targetを確認する
    if (!scene || typeof scene.getView !== "function") {
      throw new Error(`${this.label} resources require scene target`);
    }
    if (scene.getFormat?.() !== COMPUTE_SSR_INPUT_FORMAT) {
      throw new Error(`${this.label} scene format must be ${COMPUTE_SSR_INPUT_FORMAT}`);
    }
    // sampled texture viewを提供できるnormal targetであることを確認する
    if (!normal || typeof normal.getView !== "function") {
      throw new Error(`${this.label} resources require normal target`);
    }
    if (!material || typeof material.getView !== "function") {
      throw new Error(`${this.label} resources require material target`);
    }
    if (material.getFormat?.() !== COMPUTE_SSR_MATERIAL_FORMAT) {
      throw new Error(`${this.label} material format must be ${COMPUTE_SSR_MATERIAL_FORMAT}`);
    }
    // camera Reverse-Z depth sample viewを提供できるdepth targetであることを確認する
    if (
      !depth ||
      typeof depth.getDepthSampleView !== "function" ||
      depth.depthConvention !== CAMERA_REVERSE_Z
    ) {
      throw new Error(`${this.label} resources require CAMERA_REVERSE_Z depth target`);
    }
    // scene targetの寸法をG-bufferのfull解像度として保存する
    this.fullWidth = util.readFiniteNumber(
      scene.getWidth?.(),
      `${this.label} scene width`,
      { integer: true, min: 1 }
    );
    this.fullHeight = util.readFiniteNumber(
      scene.getHeight?.(),
      `${this.label} scene height`,
      { integer: true, min: 1 }
    );
    for (const [name, target] of [["normal", normal], ["depth", depth], ["material", material]]) {
      const width = target.getWidth?.();
      const height = target.getHeight?.();
      if (width !== this.fullWidth || height !== this.fullHeight) {
        throw new Error(
          `${this.label} ${name} size ${width}x${height} does not match scene size `
          + `${this.fullWidth}x${this.fullHeight}`
        );
      }
    }
    return { scene, normal, depth, material };
  }

  /**
   * SSR compute passをcommandEncoderへ記録し、結果を書き込むoutputTargetを返す
   * resourcesからG-bufferを受け取り、optionsでCamera Frame、SSR値、表示モードを指定する
   * この関数はGPU完了を待たずcommandをencodeするだけ
   * @param {GPUCommandEncoder} commandEncoder 記録先のcommand encoder
   * @param {object} resources scene、normal、material、depthを含む入力資源
   * @param {object} options Camera Frameと実行時パラメータ
   * @returns {object} SSR結果が書き込まれるoutputTarget
   */
  encode(commandEncoder, resources, options = {}) {
    // destroy後のinstanceではencodeを許可しない
    this.requireAlive();
    // GPU bindingを作る前に入力resource、Camera Frame、SSRパラメータを検証する
    const checkedResources = this.validateResources(resources);
    const performance = this.validatePerformanceOptions(options);
    this.reflectivityThreshold = performance.reflectivityThreshold;
    this.setResolutionScale(performance.resolutionScale);
    const projection = this.validateCameraFrame(options.cameraFrame);
    // optionsで未指定の値にはconstructorで確定したinstance既定値を使用する
    const parameters = this.validateParameters({
      intensity: options.intensity ?? this.defaults.intensity,
      distance: options.distance ?? this.defaults.distance,
      thickness: options.thickness ?? this.defaults.thickness,
      steps: options.steps ?? this.defaults.steps
    });
    // enabledはpass自体を省略するのではなく、uniform intensityを0にして最終反射を無効化する
    const enabled = util.readOptionalBoolean(
      options.enabled,
      `${this.label} enabled`,
      COMPUTE_SSR_DEFAULTS.enabled
    );
    // 表示モード文字列を許可された列挙値から選ぶ
    const view = util.readOptionalEnum(
      options.view,
      `${this.label} view`,
      COMPUTE_SSR_DEFAULTS.view,
      COMPUTE_SSR_VIEW_MODES
    );
    // shaderで比較しやすい数値へ表示モードを変換する
    // 0 reflection、1 normal、2 depth
    const viewMode = view === "normal" ? 1.0
      : view === "depth" ? 2.0
        : 0.0;
    // Paramsのmemory順に12個のfloatをuniform bufferへ設定する
    // projection 4個、effect 4個、control 4個の順
    this.computePass.setUniforms([
      ...projection,
      // disabled時はintensityを0にし、shader側の早期returnでray探索を省略する
      enabled ? parameters.intensity : 0.0,
      parameters.distance,
      parameters.thickness,
      parameters.steps,
      // control.xへviewMode、control.yへ低反射pixelの早期return閾値を設定する
      // z/wにはデバッグ時に確認しやすいよう出力target寸法を入れる
      viewMode,
      performance.reflectivityThreshold,
      this.rayTarget.getWidth(),
      this.rayTarget.getHeight()
    ]);
    const timestampWrites = options.timestampWrites;
    const firstTimestampWrites = timestampWrites?.beginningOfPassWriteIndex !== undefined
      ? {
          querySet: timestampWrites.querySet,
          beginningOfPassWriteIndex: timestampWrites.beginningOfPassWriteIndex
        }
      : undefined;
    const lastTimestampWrites = timestampWrites?.endOfPassWriteIndex !== undefined
      ? {
          querySet: timestampWrites.querySet,
          endOfPassWriteIndex: timestampWrites.endOfPassWriteIndex
        }
      : undefined;
    // 検証済みG-bufferとoutputTargetをbinding名へ対応付けてcompute commandを記録する
    this.computePass.encode(commandEncoder, {
      scene: checkedResources.scene,
      normal: checkedResources.normal,
      depth: checkedResources.depth,
      material: checkedResources.material,
      output: this.rayTarget
    }, {
      timestampWrites: firstTimestampWrites
    });
    this.roughnessPyramid.encode(commandEncoder, this.rayTarget);
    const half = this.roughnessPyramid.getLevel(2);
    const quarter = this.roughnessPyramid.getLevel(4);
    const eighth = this.roughnessPyramid.getLevel(8);
    this.roughnessPass.setUniforms([
      view === "reflection" ? 1.0 : 0.0,
      0.0,
      0.0,
      0.0
    ]);
    this.roughnessPass.encode(commandEncoder, {
      rawReflection: this.rayTarget,
      half,
      quarter,
      eighth,
      material: checkedResources.material,
      sampler: half.getSampler(),
      output: this.outputTarget
    }, {
      timestampWrites: lastTimestampWrites
    });
    // 後続passがroughness適用済みSSR結果を参照できるようoutputTargetを返す
    return this.outputTarget;
  }

  /**
   * 画面またはG-bufferのサイズ変更に合わせてSSR出力textureを再作成する
   * widthとheightは1以上の整数だけを受け付ける
   * @param {number} width 新しい出力幅
   * @param {number} height 新しい出力高さ
   * @returns {*} resizeTargetが返す再生成結果
   */
  resize(width, height) {
    // destroy後にtextureを作り直す操作を禁止する
    this.requireAlive();
    // 新しいG-buffer full解像度を検証してinstance状態へ保存する
    this.fullWidth = util.readFiniteNumber(width, `${this.label} width`, {
      integer: true,
      min: 1
    });
    this.fullHeight = util.readFiniteNumber(height, `${this.label} height`, {
      integer: true,
      min: 1
    });
    // 出力targetはfull解像度ではなくresolutionScale後の寸法へ更新する
    return this.setResolutionScale(this.resolutionScale);
  }

  /**
   * SSR出力targetだけを指定scaleの寸法へ更新する
   * G-buffer自体はfull解像度のまま保持し、shader内で低解像度pixelから参照座標を対応付ける
   * @param {number} scale SSR出力targetの解像度倍率
   * @returns {*} resizeTargetが返す再生成結果
   */
  setResolutionScale(scale) {
    this.requireAlive();
    this.resolutionScale = util.readFiniteNumber(scale, `${this.label} resolutionScale`, {
      min: 0.5,
      max: 1.0
    });
    this.width = scaledSsrSize(this.fullWidth, this.resolutionScale, `${this.label} scaled width`);
    this.height = scaledSsrSize(this.fullHeight, this.resolutionScale, `${this.label} scaled height`);
    const rayChanged = resizeTarget(this.rayTarget, this.width, this.height);
    const outputChanged = resizeTarget(this.outputTarget, this.width, this.height);
    const pyramidChanged = this.roughnessPyramid.resize(this.width, this.height);
    return rayChanged || outputChanged || pyramidChanged;
  }

  /**
   * 現在のSSR出力targetを取得する
   * render passや後続compute passから反射結果を参照するときに使用する
   * @returns {object} 現在のoutputTarget
   */
  getOutputTarget() {
    // destroy後のtarget参照を禁止する
    this.requireAlive();
    return this.outputTarget;
  }

  /**
   * このpassが所有するComputePassとoutput textureを破棄する
   * 複数回呼ばれても二重破棄せず、最初の呼び出しだけtrueを返す
   * @returns {boolean} この呼び出しで実際に破棄した場合はtrue
   */
  destroy() {
    // すでに破棄済みなら何もせずfalseを返す
    if (this.destroyed) {
      return false;
    }
    // pipeline関連資源と出力textureを順に破棄する
    this.computePass.destroy();
    this.roughnessPass.destroy();
    this.roughnessPyramid.destroy();
    this.rayTarget.destroy();
    this.outputTarget.destroy();
    // 以後のpublic操作をrequireAliveで拒否できるよう状態を更新する
    this.destroyed = true;
    return true;
  }
}
