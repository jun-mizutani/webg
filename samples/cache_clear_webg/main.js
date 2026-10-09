// ---------------------------------------------
// samples/cache_clear_webg/main.js  2026/09/13
//   Development utility to import every webg core module with a fresh URL
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

const CORE_MODULES = Object.freeze([
  ...`Action.js Animation.js AnimationState.js AudioSynth.js Background.js BallSocketJoint.js Billboard.js BillboardShader.js BloomPass.js BoxCollider.js BoxContact.js CameraFrame.js CapsuleCollider.js Collada.js ColladaShape.js Collider.js ColorSpace.js CommandPalette.js ComputeBloomPass.js ComputeBlurPass.js ComputeBodyState.js ComputeBoxCollider.js ComputeCapsuleCollider.js ComputeDofPass.js ComputeEdgePass.js ComputeEffectComposer.js ComputeEffectPipeline.js ComputeEffectToneMapPass.js ComputeFogPass.js ComputeImagePyramid.js ComputeJointBuffer.js ComputeJointSolver.js ComputePass.js ComputePerlinNoise2D.js ComputePhysicsPipeline.js ComputePhysicsReadback.js ComputePhysicsShader.js ComputePhysicsSpace.js ComputePlaneCollider.js ComputeProceduralTile.js ComputePyramidBlurPass.js ComputeShadowPass.js ComputeShapeContact.js ComputeSphereCollider.js ComputeSpotShadowPass.js ComputeSsrPass.js ComputeToonPass.js ComputeVignettePass.js CoordinateSystem.js CpuBoxPhysicsAdapter.js CpuBoxPhysicsSolver.js CpuMixedPhysicsPipeline.js CpuPhysicsSolver.js DebugConfig.js DebugDock.js DebugProbe.js DeferredLightingPass.js DepthConvention.js Diagnostics.js DistanceJoint.js DofPass.js EyeRig.js FixedJoint.js Font.js Frame.js FrameTimer.js FrostedGlassPass.js FullscreenPass.js GameAudioSynth.js GameMusicPresets.js GameSoundPresets.js GeometryBufferPass.js GlassMaskShader.js Gltf.js GltfShape.js GpuParticleEmitter.js GpuPassProfiler.js HingeJoint.js InputController.js Joint.js JointConstraintRow.js JointMath.js JointSolver.js JsonFormat.js MaterialParameters.js Matrix.js Mesh.js Message.js ModelAsset.js ModelBuilder.js ModelLoader.js ModelValidator.js Node.js OverlayPanel.js OverlayPanelPresets.js ParticleEmitter.js PbrBrdf.js PbrEnvironment.js PbrEnvironmentCache.js PbrEnvironmentCompute.js PbrEnvironmentDebugPass.js PbrEnvironmentEvaluation.js PbrEnvironmentReference.js PbrForwardShader.js PhysicsBackendAdapters.js PhysicsBodyRegistry.js PhysicsContactDispatcher.js PhysicsContactImpulseSolver.js PhysicsDescriptor.js PhysicsEvents.js PhysicsJointPipeline.js PhysicsMaterialPairs.js PhysicsMath.js PhysicsNode.js PhysicsQueries.js PhysicsSettings.js PhysicsSpace.js PhysicsStepPipeline.js PingPongBuffer.js PingPongTarget.js PingPongTexture.js PlaneBoxContact.js PlaneCollider.js Primitive.js ProceduralEnvironment.js ProceduralMaterials.js ProceduralTileSpec.js Quat.js RadianceHdr.js RenderTarget.js SceneAsset.js SceneLoader.js SceneText.js SceneValidator.js SceneYaml.js Schedule.js Screen.js SeparableBlurPass.js Shader.js ShadowMapPass.js Shape.js ShapeResource.js Skeleton.js SkinningConfig.js SmoothShader.js Space.js SphereCollider.js SpotShadowMapPass.js SsaoPass.js Stack.js StorageTargetFactory.js Task.js Text.js Texture.js ToneSynth.js Touch.js TranslucentRenderQueue.js TransparencyPass.js Tween.js VignettePass.js WebgApp.js WebgUiTheme.js Wireframe.js util.js`.split(/\s+/).map((name) => `../../webg/${name}`),
  ...`AuthoringVocabulary.js CameraDofConstraint.js ComputePhysicsBackend.js CpuPhysicsBackend.js JointBindings.js JointDefinition.js ModelPhysicsDiagnostics.js ModelSpatialCorrespondence.js PbrRenderer.js PhysicsBinding.js PrimitiveScene.js SceneAnimations.js SceneDefinition.js SceneFrame.js SceneHelpers.js ScenePhysics.js SceneRuntimeHelpers.js WebgSceneApp.js index.js`.split(/\s+/).map((name) => `../../webg/app/${name}`)
]);

const statusElement = document.getElementById("status");
const detailsElement = document.getElementById("details");
const reloadButton = document.getElementById("reload");

// 全moduleへ同じversionを付け、1回の実行で同じコア世代を読み込むURLを作ります
function createVersion() {
  return String(Date.now());
}

// moduleの相対URLを一意なquery付きURLへ変換し、ブラウザーの古いmodule URLを回避します
function importFresh(modulePath, version) {
  const url = new URL(`${modulePath}?v=${version}`, import.meta.url);
  return import(url.href);
}

// 成否をmodule単位で保持し、一部失敗でも残りのcore import結果を表示します
async function importAllCore() {
  const version = createVersion();
  const startedAt = performance.now();
  reloadButton.disabled = true;
  statusElement.className = "";
  detailsElement.hidden = true;
  statusElement.textContent = `全core ${CORE_MODULES.length} modulesをimport中…`;

  const results = await Promise.all(CORE_MODULES.map(async (modulePath) => {
    try {
      await importFresh(modulePath, version);
      return { modulePath, ok: true };
    } catch (error) {
      return { modulePath, ok: false, error };
    }
  }));
  const failures = results.filter((result) => !result.ok);
  const elapsedMs = performance.now() - startedAt;
  statusElement.className = failures.length === 0 ? "ok" : "error";
  statusElement.textContent = failures.length === 0
    ? `完了: ${results.length} modules imported\nversion: ${version}\nelapsed: ${elapsedMs.toFixed(1)} ms`
    : `失敗: ${failures.length}/${results.length} modules\nversion: ${version}\nelapsed: ${elapsedMs.toFixed(1)} ms`;
  if (failures.length > 0) {
    detailsElement.textContent = failures.map((result) => (
      `${result.modulePath}\n${result.error?.stack ?? result.error?.message ?? String(result.error)}`
    )).join("\n\n");
    detailsElement.hidden = false;
  }
  reloadButton.disabled = false;
  return { version, elapsedMs, failures };
}

reloadButton.addEventListener("click", () => {
  importAllCore().catch((error) => {
    statusElement.className = "error";
    statusElement.textContent = `core import failed\n${error.stack ?? error.message ?? String(error)}`;
    reloadButton.disabled = false;
  });
});

importAllCore().catch((error) => {
  statusElement.className = "error";
  statusElement.textContent = `core import failed\n${error.stack ?? error.message ?? String(error)}`;
  reloadButton.disabled = false;
});
