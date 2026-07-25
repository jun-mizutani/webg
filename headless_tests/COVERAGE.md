# headless_tests coverage

更新日: 2026-07-21

## 数え方

この文書のcoverageは、行数や分岐の百分率ではなく「どのコアを個別suiteで検証するか」を示します。
import の直接参照数だけでは、間接的に通る処理や実ブラウザでしか成立しない処理を評価できないためです。

現在は76 suite、103 caseです。Contact Shadowの実験用contractは
`user/contact_shadow`へ移したため、この集計には含めません。

| 分類 | suite | case | 役割 |
|---|---:|---:|---|
| core | 63 | 89 | webg コアが持つ決定論的な必須条件 |
| integration | 3 | 3 | 複数コアをまたぐ境界 |
| samples | 9 | 10 | sample source と API 利用方法 |
| diagnostics | 1 | 1 | 数値調査 |

## 明示的な core suite

- action
- animation
- animation_state
- billboard
- camera_frame
- color_space
- compute_bloom_pass
- compute_blur_pass
- compute_dof_pass
- compute_edge_pass
- compute_effect_composer
- compute_effect_pipeline
- compute_effect_tone_map_pass
- compute_fog_pass
- compute_pass
- compute_shadow_pass
- compute_ssr_pass
- compute_toon_pass
- compute_vignette_pass
- coordinate_system
- deferred_lighting_pass
- depth_convention
- dof_pass
- eye_rig
- frame
- frame_timer
- geometry_buffer_pass
- gpu_particle_emitter
- input_controller
- json_format
- matrix
- mesh
- model_asset
- model_builder
- model_loader
- model_validator
- node
- physics_node
- physics_space
- ping_pong_resources
- primitive
- quat
- render_target
- scene_asset
- scene_loader
- scene_validator
- schedule
- screen
- shader
- shadow_map_pass
- shape
- shape_resource
- skeleton
- skinning_config
- space
- ssao_pass
- stack
- storage_target_factory
- task
- texture
- transparency_pass
- util
- webg_app

複数クラスを一つの資源概念として扱うものがあります。
`ping_pong_resources` は `PingPongBuffer`、`PingPongTarget`、`PingPongTexture`、
`physics_node` と `physics_space` は collider 群との連携も確認します。
したがって63 suiteという数を、そのまま機能coverage率とは扱いません。

## 統合・sample・diagnostics

- integration: presentation、rendering_conventions、rendering_depth_pipelines
- samples: bloom、compute_bloom、compute_effect、custom_depth、low_level、materials、maze2、mmodeler、startup
- diagnostics: physics_collider

sample suite は sample source の import、初期化、pipeline 接続などを静的に確認します。
サンプルの画面表示や操作を確認するテストではありません。

## 今回補った領域

`unittest/` にブラウザページとして置かれていたものの、画面・DOM・GPUを契約上必要としなかった次のテストを Node.js 用に変更しました。

- `AnimationState`: 定義エラー、初期状態、priority、遷移、callback
- `PhysicsNode`: body type、速度、sleep、teleport、impulse、collider と material
- `PhysicsSpace`: timestep、接触、摩擦、sleep、layer、trigger、query、raycast、各 collider

さらに、ブラウザやGPUを必要としない基盤コア13件を追加しました。

- animation: Action、Animation
- math / hierarchy: Quat、CoordinateSystem、Frame
- state execution: Schedule、Task、Stack
- conversion / formatting: ColorSpace、JsonFormat、util
- validation: ModelValidator、SceneValidator

これにより、従来の66 caseに、ブラウザcontractからの3 caseと基盤コア13 caseを加え、
ブラウザを開かずに全82 caseを実行できます。

続いて、resource / asset lifecycleを所有する13コアを追加しました。

- geometry resource: ShapeResource、Primitive、Mesh、Shape
- model resource: ModelAsset、ModelBuilder、ModelLoader
- scene resource: SceneAsset、SceneLoader
- skinning resource: Skeleton、SkinningConfig
- GPU resource wrapper: Shader、Texture

GPU resource wrapperは実deviceでのshader compileや描画結果を検証するものではありません。
共通mockを使い、buffer / texture / samplerの生成要求、queue write、bind group情報、
destroy、CPU側dataとの対応など、ブラウザを必要としない所有権契約を確認します。
この追加により、73 suite、95 caseを実行できます。

最後に、ブラウザだけで自動実行していた`unittest/ai_contracts`を所有コアへ分割しました。

- `Screen`: resize、aspect、推奨FOV、入力境界
- `WebgApp`: init前のlifecycle誤用
- `Shape` / `ShapeResource`: buffer確定、参照guard、破棄
- `InputController`: key正規化、action、edge、pulse、frame snapshot、default抑止

`Shape` / `ShapeResource`は既存caseが契約を包含していました。
`Screen`と`WebgApp`へ各1 case、`InputController`へ新しい1 suite / 1 caseを追加し、
現在は74 suite、98 caseです。

## 既知不一致

現行実装と一致しない契約は4件あります。

- `PhysicsSpace`: restitution 0 の plane contact で上向き速度をほぼ0に抑える
- `PhysicsSpace`: restitution 0 の plane と回転する長い box の接触で過大な回転を抑える
- `Schedule`: instanceから`pause()`を呼べる
- `Animation`: bone nameの範囲外境界で`null`を返す

これらは今回の整理作業でコア実装や期待値を変更せず、`XFAIL` として継続監視します。
条件が成立した場合は `XPASS` を失敗として扱い、既知不一致指定の削除を促します。

## 次に追加する優先領域

ブラウザを必要としない基盤コア、validator、resource / asset lifecycleは追加済みです。
次は、loader形式とブラウザ依存境界を分けて検討します。

- Gltf、GltfShape
- Collada、ColladaShape
- Font / Textのデータ変換部と表示部の分離
- Backgroundの設定値と実描画の分離

ブラウザ依存境界は、headless 化の量ではなく実契約を保つことを優先します。

- Screen の実 device / canvas
- WebgApp のブラウザ lifecycle
- InputController、Touch の DOM event
- AudioSynth 系の Web Audio
- UI、overlay、font、text の表示
- shader compile、render / compute pipeline の実 GPU validation

`unittest/ai_contracts`の純粋な契約は所有コアへ分割済みです。
`OverlayPanelPresets`はoption組み立てだけをheadlessで所有し、実際のoverlay表示は所有しません。
実deviceでのframe成立はheadless成功だけでは保証せず、ブラウザPOCとsampleで確認します。
