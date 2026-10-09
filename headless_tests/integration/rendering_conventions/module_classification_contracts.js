// ---------------------------------------------------------
// headless_tests/integration/rendering_conventions/module_classification_contracts.js  2026/10/04
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
  "ComputeParticleEmitter.js",
  "ComputeParticlePass.js",
  "ComputeParticleSettings.js",
  "ComputeParticleShaders.js",
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
  "PbrBrdf.js",
  "PbrEnvironment.js",
  "PbrEnvironmentCompute.js",
  "PbrEnvironmentDebugPass.js",
  "PbrEnvironmentReference.js",
  "PbrForwardShader.js",
  "RenderTarget.js",
  "Screen.js",
  "SmoothShader.js",
  "Space.js",
  "SsaoPass.js",
  "TransparencyPass.js",
  "WaterDepthPass.js",
  "WaterLayerPass.js",
  "WaterLightingWgsl.js",
  "WaterReceiverMask.js",
  "WaterSurfacePass.js",
  "WaterSurfaceWgsl.js",
  "WaterSystem.js",
  "WebgApp.js",
  "Wireframe.js"
].sort();

// Light Viewから作るShadow Mapの生成だけは、第一実装期の設計どおり通常Zを使用します
const intentionalStandardZModules = [
  "ShadowMapPass.js",
  "SpotShadowMapPass.js"
].sort();

// local data、UI、asset、physics、汎用GPU資源などを担当し、座標・深度基盤を利用する側のmoduleです
const unchangedModules = [
  "WaterBody.js",
  "WaterCausticField.js",
  "WaterWaveWgsl.js",
  "Action.js",
  "Animation.js",
  "AnimationState.js",
  "AudioSynth.js",
  "BallSocketJoint.js",
  "BloomPass.js",
  "BoxCollider.js",
  "BoxContact.js",
  "CapsuleCollider.js",
  "Collada.js",
  "ColladaShape.js",
  "Collider.js",
  "CommandPalette.js",
  "ComputeBoxCollider.js",
  "ComputeCapsuleCollider.js",
  "ComputeBodyState.js",
  "ComputeJointBuffer.js",
  "ComputeJointSolver.js",
  "ComputePass.js",
  "ComputePerlinNoise2D.js",
  "ComputePhysicsSpace.js",
  "ComputePhysicsPipeline.js",
  "ComputePhysicsReadback.js",
  "ComputePhysicsShader.js",
  "ComputePlaneCollider.js",
  "ComputeProceduralTile.js",
  "ComputeShapeContact.js",
  "CpuBoxPhysicsAdapter.js",
  "CpuBoxPhysicsSolver.js",
  "CpuMixedPhysicsPipeline.js",
  "CpuPhysicsSolver.js",
  "ProceduralMaterials.js",
  "ProceduralPebblePattern.js",
  "ProceduralTileSpec.js",
  "CoordinateSystem.js",
  "DebugConfig.js",
  "DebugDock.js",
  "DebugProbe.js",
  "Diagnostics.js",
  "DistanceJoint.js",
  "DocumentAsset.js",
  "EyeRig.js",
  "FixedJoint.js",
  "Frame.js",
  "FrameTimer.js",
  "FrostedGlassPass.js",
  "GameAudioSynth.js",
  "GameMusicPresets.js",
  "GameSoundPresets.js",
  "Gltf.js",
  "GltfShape.js",
  "GpuPassProfiler.js",
  "HingeJoint.js",
  "InputController.js",
  "Joint.js",
  "JointConstraintRow.js",
  "JointMath.js",
  "JointSolver.js",
  "JsonFormat.js",
  "MaterialParameters.js",
  "Mesh.js",
  "Message.js",
  "ModelAsset.js",
  "ModelBuilder.js",
  "ModelLoader.js",
  "ModelValidator.js",
  "OverlayPanel.js",
  "OverlayPanelPresets.js",
  "ParticleEmitter.js",
  "PbrEnvironmentCache.js",
  "PbrEnvironmentEvaluation.js",
  "PhysicsNode.js",
  "PhysicsBackendAdapters.js",
  "PhysicsBodyRegistry.js",
  "PhysicsContactDispatcher.js",
  "PhysicsContactImpulseSolver.js",
  "PhysicsDescriptor.js",
  "PhysicsEvents.js",
  "PhysicsJointPipeline.js",
  "PhysicsMaterialPairs.js",
  "PhysicsMath.js",
  "PhysicsQueries.js",
  "PhysicsSettings.js",
  "PhysicsSpace.js",
  "PhysicsStepPipeline.js",
  "PingPongBuffer.js",
  "PingPongTarget.js",
  "PingPongTexture.js",
  "PlaneBoxContact.js",
  "PlaneCollider.js",
  "Primitive.js",
  "ProceduralEnvironment.js",
  "Quat.js",
  "RadianceHdr.js",
  "SceneAsset.js",
  "SceneLoader.js",
  "SceneText.js",
  "SceneValidator.js",
  "SceneYaml.js",
  "Schedule.js",
  "SeparableBlurPass.js",
  "Shader.js",
  "Shape.js",
  "ShapeResource.js",
  "Skeleton.js",
  "SkinningConfig.js",
  "SphereCollider.js",
  "ComputeSphereCollider.js",
  "Stack.js",
  "StorageTargetFactory.js",
  "Task.js",
  "Text.js",
  "Texture.js",
  "ToneSynth.js",
  "Touch.js",
  "TranslucentRenderQueue.js",
  "Tween.js",
  "VignettePass.js",
  "WebgUiTheme.js",
  "util.js"
].sort();

// 全JS moduleが三分類のいずれかへ一度だけ登録されていることを照合し、追加時の分類漏れを検出します
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
