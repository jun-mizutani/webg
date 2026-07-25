# compute_ssr

[English](README.en.md) | 日本語

![compute_ssr](./compute_ssr.jpg)

## 概要

SSR は、画面内にすでに描かれている color、depth、normal を使って反射を近似する screen-space effect です。このサンプルでは `GeometryBufferPass` が生成する albedo、view-space normal、depth を `ComputeSsrPass` が読み、view-space の反射 ray を screen へ再投影しながら探索します。

`ComputeSsrPass` では、固定の `distance / steps` 間隔だけで進める方式ではなく、screen 上の移動量を見て coarse step 数を動的に決めます。`distance` は UI 上の探索距離上限として扱い、camera 方向へ進む ray は near plane 手前で `usableDistance` に切ります。そのうえで ray の screen 上の主軸 pixel 長から coarse step 数を求めます。

5 回の binary search で交差区間を 1/32 まで詰められる前提にし、coarse march は約 8px 間隔を目安にします。ただし負荷を抑えるため、最大 coarse step 数は `steps * 2`、絶対上限は 128 です。binary search と「最初の有効 hit だけ採用」は維持しています。

負荷を下げるため、`ComputeSsrPass` は SSR の出力 target だけを低解像度化できます。既定の `resolutionScale` は `0.7` で、指定範囲は `0.5..1.0` です。G-buffer は full 解像度のまま保持し、低解像度の SSR pixel から対応する G-buffer pixel を参照します。また `reflectivityThreshold` の既定値は `0.05` で、`albedo.a * intensity` がこの値以下の pixel では ray marching を省略します。`enabled=false` や `intensity=0` のときも ray marching を行わず、base color または reflection view の黒を返します。

```text
dynamicSteps = clamp(
  ceil(projectedRayPixels / 8),
  baseSteps,
  min(baseSteps * 2, 128)
)

stepLength = usableDistance / dynamicSteps
```

`FrameTimer` は G-buffer 生成を GPU Render 時間、SSR ray marching を GPU Compute 時間として timestamp query で計測します。Help panel と CommandPalette には各時間と frame 間隔に対する load を表示します。最後の fullscreen copy は計測対象外です。

## 実行方法

- 実行ファイルは [./compute_ssr.html](./compute_ssr.html) です
- WebGPU 対応ブラウザで開き、Help panel と CommandPalette を合わせて確認してください

## 確認ポイント

`V` で `composite / scene / reflection / normal / depth` を切り替えます。`reflection` 表示では反射成分だけを確認でき、`normal` と `depth` 表示では ray marching の入力を確認できます。

`1` と `2` は reflection intensity、`3` と `4` は ray distance、`5` と `6` は depth thickness、`7` と `8` は基準 step 数です。`9` と `0` は `SSR Scale` を下げる / 上げる操作で、`Reflect Min` は CommandPalette の3ページ目で変更します。distance を長くすると遠い反射候補へ届きますが、screen-space SSR なので画面外や遮蔽物の裏側は反射できません。

Help panel の `GPU compute / GPU render / GPU total / JS time` と load が更新されることも確認します。GPU Compute は SSR pass だけを計測するため、同じ scene と画面解像度で ray marching 方式を比較しやすくなっています。
