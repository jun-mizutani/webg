# webg 3.0 scene app core

このフォルダは、`WebgApp`を基盤にPBR表示とCompute physicsを組み合わせるwebg 3.0の高水準層です。

利用者向けの入口は`index.js`です。

```js
import { createWebgSceneApp } from "./index.js";

const app = await createWebgSceneApp({
  project: "./scene.webg.yaml",
  renderMode: "ondemand"
});
app.start();
```

| module | 責務 |
|---|---|
| `WebgSceneApp.js` | scene定義からアプリを初期化し、start／stop／resetを提供 |
| `SceneDefinition.js` | SceneYAML／JSON project、外部材質・物理manifest、scene assetを読み込み・検証 |
| `../SceneYaml.js` | project manifest向けの限定YAML parser |
| `PbrRenderer.js` | `PbrEnvironmentCompute`によるPBR環境、照明、画面効果、tone map |
| `ScenePhysics.js` | Compute physicsを標準にしたbody・Joint・readback操作 |
| `SceneFrame.js` | 固定step、GPU readback、Node同期をframeへ接続 |
| `PrimitiveScene.js` | primitive objectとobjectSetの構築 |

`SceneFrame.js`以下の補助moduleとbackendは、公開入口が使う内部実装です。既存の`webg/PhysicsSpace.js`はCPU物理の低水準API、`webg/ComputePhysicsSpace.js`はCompute物理の低水準APIとして役割を保ちます。

`WebgSceneApp`のPBR環境は、手続きradianceをCPUで作り、irradiance、roughness別specular mip、BRDF LUTを`PbrEnvironmentCompute`でGPU生成します。CPUで前処理済みlevelを明示的に転送する場合は、`PbrEnvironment`と`createProceduralEnvironmentData()`を個別に使います。

`WebgSceneApp`の`renderMode`は`"ondemand"`と`"continuous"`を選べます。既定値は`"ondemand"`で、ページが非表示またはフォーカスを失ったときにframe loopを休止します。

`SceneDefinition`はproject URLだけでなく、`materialsUrl`と`physicsUrl`も拡張子に応じて読み込みます。`.yaml`／`.yml`は`SceneYaml.js`、`.json`はJSON parserを使います。

`.yaml.gz`／`.yml.gz`／`.json.gz`はgzip展開後に同じ読込み経路へ渡します。`index.js`の`compressSceneYAML(text)`は、原文をgzip圧縮した`Promise<Blob>`を返します。Blenderでの往復編集は[SceneYAMLアドオン](../../blender_addon/README.md)を参照してください。

ModelAsset／SceneAssetの外部材質manifestは、`pbr`、`preset`、`textures`のいずれかを選べます。`textures`では`textures.colorUrl`と`textures.normalUrl`から保存済み画像を読み込み、`appearance`のPBR値と合わせてShapeへ適用します。
