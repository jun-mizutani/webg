# Build 3D Applications with webg

This book introduces `webg` to JavaScript developers building 3D applications. Begin with a small rendered scene, then add models, input, and animation before exploring PBR, physics, and GPU computing.

The five parts are organized by learning goal, and chapters are numbered 01–42. First-time readers can follow the introductory examples in order. When adding a feature to an application, start with the chapter for that task.


To use `lib/webg.core.min.js`, start with “Load the Bundled Library” in
Chapter 2. Chapter 4 shows the import replacement for the same minimal example.
[Appendix C](Appendix_C_Bundle.md) covers sample conversion. The class and method
descriptions in this book apply to both loading methods.

## Where to Start

To choose an existing example for the application you want to build, begin with [Development Entry Points and Runnable Examples](ExampleGuide.md). The [browser guide](../book/examples/guide.html) collects starting points by goal, the order for adding features, code to read, and checks to make. It serves both people and AI agents.

Begin with the [preface](00_Preface.md), then follow Part I, from minimal rendering through `WebgApp`, cameras, and materials.

Part II covers reusable models with ModelYAML, complete applications with SceneYAML, animation, UI, input, collision queries, sound, and diagnostics.

Part III explains shaders and GPU computing. Use Part IV when you need to extend visual expression with screen effects, physics, PBR, or procedural textures.

Part V investigates coordinate transforms, depth, G-buffers, `Shape`, skinning, and physics internals.

To go from a PBR scene to a small game with movement, selection, and particles, read [PBR Scene to a Small Game](PBRSceneToGame.md) alongside `samples/fantasy/`. Its [browser guide](../book/examples/fantasy_guide.html) points to functions to read and small experiments to try.

For water reflections, refraction, and underwater caustics, compare Chapter 35 with `samples/water/index.html`. To integrate `WaterBody`, receiver registration, independent toggles, particles, screen effects, and resource disposal into a game, continue to `samples/fantasy/`.

## Parts and Chapters

### Part I: Foundations for Getting Started

1. `01_Introduction.md`
2. `02_Runtime.md`
3. `03_SpaceBasics.md`
4. `04_MinimalRender.md`
5. `05_AppStructure.md`
6. `06_CameraRig.md`
7. `07_ShaderMaterials.md`

### Part II: Assemble an Application

1. `08_Models.md`
2. `09_Scenes.md`
3. `10_Animation.md`
4. `11_AnimationAssets.md`
5. `12_UI.md`
6. `13_HUD.md`
7. `14_Input.md`
8. `15_Collision.md`
9. `16_Audio.md`
10. `17_Diagnostics.md`

### Part III: Shaders and GPU Computing

1. `18_WGSL.md`
2. `19_Shaders.md`
3. `20_Compute.md`
4. `21_ComputeFlow.md`
5. `22_ComputeData.md`

### Part IV: Extend Visual Expression

1. `23_PostFX.md`
2. `24_BloomDoF.md`
3. `25_Transparency.md`
4. `26_Particles.md` — standard Compute particles, SceneYAML, emission, stopping, capacity, and CPU alternatives
5. `27_Physics.md`
6. `28_PhysicsEvents.md`
7. `29_ProceduralTextures.md`
8. `30_PBR.md`
9. `31_PBRDesign.md`
10. `32_PBRSetup.md`
11. `33_PBRDiagnostics.md`
12. `34_ScreenEffects.md`
13. `35_LightingEffects.md`
14. `36_DoFStyleParticles.md`

### Part V: Understand the Internals

1. `37_LowLevelAPI.md`
2. `38_ShapeMeshes.md`
3. `39_ProceduralShapes.md`
4. `40_Skinning.md`
5. `41_RenderPipeline.md`
6. `42_PhysicsInternals.md`

## Appendices

- `00_Preface.md`
- `Appendix_A_ForAI.md`
- `Appendix_B_Migration.md`
- [Appendix C: Using the Bundled Library](Appendix_C_Bundle.md)
- `99_Afterword.md`

Use the [API catalog](Appendix_D_API.md) as a separate reference for API names and owning classes. Each chapter begins with prerequisites, a first-pass reading range, sections to consult as needed, and learning goals. Runnable examples are available in `book/examples/`.
