# WebgSceneAppサンプル

`project_app`は、webg 3.0の`WebgSceneApp`と高水準scene定義を使って、PBR表示、Compute physics、Joint、多数物体の配置を構成する独立サンプルです。

このフォルダのHTML、JavaScript、SceneYAML project、scene assetで実行できます。高水準共通moduleの正規実装は`../../webg/app/`から読み込みます。

## サンプルの順番

1. [project_app_sphere_plane.html](./project_app_sphere_plane.html)で、`objects[]`、material、Sphere、Plane、Compute bodyの最小構成を確認します
2. [project_app_joint.html](./project_app_joint.html)で、`physics.joints[]`のbody参照をobject IDで指定します
3. [project_app_joint_compute_node.html](./project_app_joint_compute_node.html)で、SceneYAMLの複数Joint、GPU Compute physics、readback後のNode描画を確認します
4. [project_app_object_set.html](./project_app_object_set.html)で、prototypeと`grid3d`から16個のBoxを生成します
5. [project_app_object_set_variants.html](./project_app_object_set_variants.html)で、Sphere、Capsule、Boxのvariantと個体ごとの値を指定します
6. [project_app_physics.html](./project_app_physics.html)で、Blender制作シーンのscene asset、PBR manifest、Compute physicsを一つのprojectへ接続します
7. [domino_36_03.html](./domino_36_03.html)で、作品規模のprojectを確認します

各ページはWebGPU対応ブラウザーで開き、Start、Stop、Resetを操作できます。`project_app_physics.html`は`assets/domino2_scene_asset.json.gz`を読み込みます。

`project_app_joint_compute_node.html`は、`joint_compute_node.html`のロープ、振り子、通過CapsuleをSceneYAMLへ移した例です。物理bodyと61個のDistance Jointはproject YAMLで定義し、JavaScriptはkinematic Capsuleの移動、振り子connectorの表示同期、Start／Stop／Resetだけを担当します。`Q`でquasiStatic、`I`でimpact、`A`と`D`でCapsuleの移動方向を切り替えます。

## SceneYAML object animation

[scene_animation.html](./scene_animation.html)は、独立した床・固定柱と、移動・回転するゲート、追従する子のSphere／Capsuleを表示します。[scene_animation.yaml](./scene_animation.yaml)は`format: webg-scene`、`version: 1`の新形式です。[JavaScript](./scene_animation_demo.js)は公開アニメーションAPIを使い、`renderMode: "ondemand"`、`physics: false`で動作します。HTTPサーバーからWebGPU対応ブラウザーで開いてください。

Playは先頭から再生し、Loopは既定でオフです。PauseとStopは現在の姿勢を保持し、Resumeは一時停止から再開します。Seekは指定秒へ移動して一時停止します。Reset animationsは全clipを停止して基準配置へ戻し、Reset sceneはアニメーションと物理のリセットを呼びます（この例は物理なし）。Start frames／Stop framesはフレームループだけの操作です。フレーム停止中の姿勢変更は再開後に描画されます。

ゲートの基準姿勢はEuler角でY軸15度、最初のキーは0度なので、ResetとSeek(0)の違いが分かります。キーの回転は`[w, x, y, z]`、位置は絶対local値です。親の正の一様scaleは一定です。2〜3秒は開いた姿勢を保持し、5秒で一回再生を終えます。

圧縮版は`gzip -n -9 -c samples/project_app/scene_animation.yaml > samples/project_app/scene_animation.yaml.gz`で生成し、[gzip版ページ](./scene_animation.html?gzip=1)で読み込みます。任意の[ブラウザーprobe](../../tools/scene_animation/browser_probe.js)はページのready後、コンソールで`await (await import('/tools/scene_animation/browser_probe.js')).runSceneAnimationProbe()`を実行します。再生・保持・seek・loop・resetの状態とUIを検査し、最後に基準配置へ戻します。画素、親子のworld姿勢、物理の検証は含みません。

## 利用者が編集する場所

- 物体の形状、配置、物理値：SceneYAML projectの`objects[]`
- 多数物体の共通定義と配置：`objectSets[]`
- 色、metallic、roughness、specular：`materials`
- 物体と材質の関係：`objects[].material`
- Jointの接続先：`physics.joints[]`
- Blenderのmesh、UV、Node：`assets/*.scene.json.gz`

すべての実行サンプルがSceneYAML projectを参照します。JSON projectとJSONの外部manifestも、`SceneDefinition`の同じ検証処理で読み込めます。

実行時の入口は各demo JavaScriptの`createWebgSceneApp()`です。WebgSceneAppがscene定義の検証、NodeとShapeの生成、PBR準備、Compute body登録、固定step、readback、Resetをまとめます。作品側のJavaScriptはカメラ、ボタン、作品固有の入力と表示だけを記述します。

## 内部module

各demoは`../../webg/app/index.js`から`createWebgSceneApp()`を読み込みます。アプリのシーン構築には、coreの`WebgSceneApp`、`SceneDefinition`、`ScenePhysics`を利用します。
