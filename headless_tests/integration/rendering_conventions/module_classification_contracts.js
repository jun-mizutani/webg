// ---------------------------------------------------------
// headless_tests/integration/rendering_conventions/module_classification_contracts.js  2026/07/23
//   Exhaustive v2 coordinate/depth module classification
// ---------------------------------------------------------
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webgDirectory = fileURLToPath(new URL("../../../webg/", import.meta.url));

// 第2版の座標・深度・Deferred Shading契約へ変更し、対応v2 testが成功済みのmoduleです
const okModules = [
  "Background.js",
  "Billboard.js",
  "BillboardShader.js",
  "CameraFrame.js",
  "ColorSpace.js",
  "ComputeBloomPass.js",
  "ComputeBlurPass.js",
  "ComputeDofPass.js",
  "ComputeEdgePass.js",
  "ComputeEffectComposer.js",
  "ComputeEffectPipeline.js",
  "ComputeEffectToneMapPass.js",
  "ComputeFogPass.js",
  "ComputeImagePyramid.js",
  "ComputePyramidBlurPass.js",
  "ComputeShadowPass.js",
  "ComputeSpotShadowPass.js",
  "ComputeSsrPass.js",
  "ComputeToonPass.js",
  "ComputeVignettePass.js",
  "DeferredLightingPass.js",
  "DepthConvention.js",
  "DofPass.js",
  "Font.js",
  "FullscreenPass.js",
  "GeometryBufferPass.js",
  "GlassMaskShader.js",
  "GpuParticleEmitter.js",
  "Matrix.js",
  "Node.js",
  "RenderTarget.js",
  "Screen.js",
  "SmoothShader.js",
  "Space.js",
  "SsaoPass.js",
  "TransparencyPass.js",
  "WebgApp.js",
  "Wireframe.js"
].sort();

// Light Viewから作るShadow Mapの生成だけは、第一実装期の設計どおり通常Zを使用します
const intentionalStandardZModules = [
  "ShadowMapPass.js",
  "SpotShadowMapPass.js"
].sort();

// 座標・深度基盤を所有せず、local data、UI、asset、physics、汎用GPU資源などを担当するmoduleです
const unchangedModules = [
  "Action.js",
  "Animation.js",
  "AnimationState.js",
  "AudioSynth.js",
  "BloomPass.js",
  "BoxCollider.js",
  "CapsuleCollider.js",
  "Collada.js",
  "ColladaShape.js",
  "Collider.js",
  "CommandPalette.js",
  "ComputePass.js",
  "CoordinateSystem.js",
  "DebugConfig.js",
  "DebugDock.js",
  "DebugProbe.js",
  "Diagnostics.js",
  "EyeRig.js",
  "Frame.js",
  "FrameTimer.js",
  "FrostedGlassPass.js",
  "GameAudioSynth.js",
  "Gltf.js",
  "GltfShape.js",
  "InputController.js",
  "JsonFormat.js",
  "Mesh.js",
  "Message.js",
  "ModelAsset.js",
  "ModelBuilder.js",
  "ModelLoader.js",
  "ModelValidator.js",
  "OverlayPanel.js",
  "OverlayPanelPresets.js",
  "ParticleEmitter.js",
  "PhysicsNode.js",
  "PhysicsSpace.js",
  "PingPongBuffer.js",
  "PingPongTarget.js",
  "PingPongTexture.js",
  "PlaneCollider.js",
  "Primitive.js",
  "Quat.js",
  "SceneAsset.js",
  "SceneLoader.js",
  "SceneValidator.js",
  "Schedule.js",
  "SeparableBlurPass.js",
  "Shader.js",
  "Shape.js",
  "ShapeResource.js",
  "Skeleton.js",
  "SkinningConfig.js",
  "SphereCollider.js",
  "Stack.js",
  "StorageTargetFactory.js",
  "Task.js",
  "Text.js",
  "Texture.js",
  "ToneSynth.js",
  "Touch.js",
  "Tween.js",
  "VignettePass.js",
  "WebgUiTheme.js",
  "util.js"
].sort();

// 全JS moduleが一度だけ三分類へ入り、新規module追加時に監査漏れを成功扱いしません
{
  const actualModules = readdirSync(webgDirectory)
    .filter((name) => name.endsWith(".js"))
    .sort();
  const classified = [
    ...okModules,
    ...intentionalStandardZModules,
    ...unchangedModules
  ].sort();
  assert.deepEqual(classified, actualModules);
  assert.equal(new Set(classified).size, classified.length, "a module must have one classification");
}

// depth24plusはコアから排除し、通常Z生成moduleは専用の二つだけに固定します
{
  const sourceByModule = new Map(
    readdirSync(webgDirectory)
      .filter((name) => name.endsWith(".js"))
      .map((name) => [name, readFileSync(`${webgDirectory}/${name}`, "utf8")])
  );
  for (const [name, source] of sourceByModule) {
    assert.doesNotMatch(source, /depth24plus/, `${name} must not use depth24plus`);
  }
  for (const name of intentionalStandardZModules) {
    const source = sourceByModule.get(name);
    assert.match(source, /SHADOW_STANDARD_Z/);
    if (name === "ShadowMapPass.js") {
      assert.match(source, /depthConvention\s*=\s*SHADOW_STANDARD_Z/);
    } else {
      assert.match(source, /makeProjectionMatrix\([^;]+SHADOW_STANDARD_Z\)/s);
      assert.match(source, /extends ShadowMapPass/);
    }
  }
}

// 変更不要とした保留候補の根拠を機械的にも固定します
{
  const coordinateSource = readFileSync(`${webgDirectory}/CoordinateSystem.js`, "utf8");
  const eyeRigSource = readFileSync(`${webgDirectory}/EyeRig.js`, "utf8");
  const particleSource = readFileSync(`${webgDirectory}/ParticleEmitter.js`, "utf8");
  assert.doesNotMatch(coordinateSource, /Float32Array|GPUBufferUsage|depthCompare/);
  assert.doesNotMatch(eyeRigSource, /Float32Array|GPUBufferUsage|depthCompare/);
  assert.match(particleSource, /new Billboard\(/);
  assert.doesNotMatch(particleSource, /GPUBufferUsage|depthCompare/);
}

console.log("rendering_conventions_module_classification_contracts: all core modules classified exactly once");
