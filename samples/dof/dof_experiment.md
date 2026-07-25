# `samples/dof` におけるリアルタイム被写界深度表現の比較実験

## 要旨

本稿は、webg の `samples/dof` に実装した被写界深度表現を対象として、リアルタイム描画で扱いやすい DoF の構成を実験的に検討した記録である。比較した方式は、3 段階の分離 blur texture を深度に応じて合成する多段階ぼかし（staged blur）と、深度差から求めた CoC 相当値にもとづいて周辺 pixel を読む 64 tap gather 型 DoF である。前者は滑らかな blur を得やすいが depth 境界で色漏れを起こしやすく、後者は depth-aware な sample 抑制により境界を制御しやすいが sample 数に比例した負荷を持つ。

実験では、`DofPass` の実装を、1. 直接光 diffuse / specular を含む scene color を blur 元にする、2. 多段階ぼかしを `scene -> small -> medium -> large` の段階遷移として合成する、3. CoC gather を比較用経路として一時的に実装する、4. 多段階ぼかしの段階数と解像度を切り替えて benchmark できる、という形に整理した。そのうえで MacBook Pro M4 Max、Windows RTX3070、Intel 770 の 3 環境で GPU timestamp による benchmark を取得した。

結果として、標準経路には多段階ぼかしが適していると判断した。`Staged Full` は 3 環境すべてで CoC gather より軽く、特に Intel 770 では CoC が `Staged Full` の約 1.85 倍に達した。また多段階ぼかしの負荷は、large blur ではなく small blur が支配的であることが分かった。これは、大きい blur を低解像度 target で作る現在の構成では、画面解像度に近い small blur の生成が最も高価になるためである。

追加実験として、実用上扱いやすい `blurRadius = 2.0` を前提に、stage ごとの blur iteration を削減した場合の cost も測定した。その結果、`small = 1`、`medium = 2`、`large = 4` の構成は、全 stage を 6 iteration にする構成の約 46.9% の GPU 時間で動作した。さらに `medium = 2` は `medium = 3` より約 7.0% 軽く、見た目の改善量に対して追加 cost が小さくないことが分かった。最終的に、CoC gather は小 blur 条件で軽い場面がある一方、強い blur 条件の表示品質と負荷のバランスが標準経路として弱いため、公開実装からは削除し、多段階ぼかしの stage 別 iteration を core に取り込む判断とした。

## 1. 研究背景

リアルタイム 3DCG の被写界深度は、物理的なレンズを忠実に再現する処理ではなく、見た目の自然さと frame budget の間で近似を選ぶ問題として現れる。オフラインレンダリングでは、レンズ面上の複数位置から ray を飛ばす分散レイトレーシングや、カメラや lens sample を変えて複数回レンダリングし平均する accumulation 系の方法を採れる。これらは物理的には明快であるが、WebGPU 上でブラウザの 1 frame 内に収めるには計算量が大きい。

そのため、リアルタイム用途では、scene を一度通常通り描画したあと、color buffer と depth buffer を使って postprocess として DoF を近似する方法が実用的である。代表的な方向性は、周辺 pixel を読み集める gather 型、blur 済み画像を解像度違いで複数作って合成する multi-scale blur 型、各 pixel を CoC に応じた sprite として周囲へ散布する scatter 型に分けられる。

gather 型は、各 pixel で depth に応じた半径を決め、その範囲から color を集める。sample 先の depth を見ながら重みを落とせるため、前景と背景の境界を制御しやすい。ただし sample 数がそのまま fragment cost になり、少数 sample では ring や放射状の pattern が残りやすい。multi-scale blur 型は、事前に複数段階の blur 画像を作り、最終合成時に depth から求めた blur 量で補間する。大きい blur を低解像度で作れるため負荷が安定しやすい一方、blur 画像生成時に depth 境界を扱わない場合は色漏れが起きる。scatter 型は玉ボケの形状を直接出しやすいが、overdraw、重なり順、書き込み競合、前景と背景の分離などの実装課題が大きい。

`samples/dof` は、webg の公開サンプルとして読めること、ブラウザ上で安定して動くこと、CommandPalette で効果を観察できることを重視している。この条件では、まず multi-scale blur 型を基準経路として実装し、境界制御の比較対象として gather 型を残す構成が妥当である。本稿の目的は、その判断を、実装内容、視覚的観察、GPU 計測の 3 点から検証することである。

## 2. 実験対象

実験対象は `samples/dof` と、その中で使用する `webg/DofPass.js` である。`samples/dof/main.js` は `WebgApp` を起動基盤とし、通常の scene 描画を `DofPass` の offscreen `RenderTarget` へ出力したあと、`DofPass.render()` によって debug target と最終 composite を作る。

scene には、奥行き方向の違いが観察しやすいように、近景、焦点付近、遠景の球群と 3 本の縦長四角柱 marker を置いた。四角柱は細い形状を大きく blur したときの伸び、色漏れ、段階切り替わりを見つけやすい。focus 面は 3D scene 内の小球による十字 guide で表示し、CommandPalette から `Focus Dist`、`Focus Range`、`Focus Hold`、`Blur Radius`、`Stage Cnt`、stage 別 iteration などを変更できる。

重要な実装方針として、blur 元の color には通常の forward 描画結果をそのまま用いる。すなわち、材質色だけでなく、直接光の diffuse と specular highlight を含んだ scene color を blur する。これは、sharp な scene には specular が存在するのに、blur 画像へ切り替わった瞬間だけ highlight が消えるという不自然さを避けるためである。光学的な blur として見せるなら、postprocess へ渡る前の照明済み画像を入力にする方が連続性を保ちやすい。

## 3. 実装アルゴリズム

### 3.1 全体の処理フロー

`DofPass` の 1 frame は次の処理フローで構成される。

1. `beginScene()` で color + sampleable depth を持つ `sceneTarget` へ 3D scene を描く。
2. `render()` で `depthDebugTarget`、`focusDebugTarget`、`stageDebugTarget` を更新する。
3. 多段階ぼかしの場合だけ、`sceneTarget` から small / medium / large の blur texture を必要段階分だけ作る。
4. composite shader が scene color、3 段階 blur color、depth を読み、最終 color を canvas へ出力する。

実験中の CoC mode では多段階ぼかし用 blur pass を実行しない構成にした。DoF off の場合も blur pass を実行せず、composite は scene color をそのまま返す。これは benchmark で `DOF Off` の値を基準値として使うために重要である。DoF off でも blur pass が走ると、見た目は off でも測定値は多段階ぼかしと近くなり、差分解析ができなくなる。

`DofPass.runCompositePass()` の処理は次の構造である。

```js
let blurSmallTarget = this.sceneTarget;
let blurMediumTarget = this.sceneTarget;
let blurLargeTarget = this.sceneTarget;

if (this.enabled && this.dofMode === "staged") {
  blurSmallTarget = this.blurPassSmall.render(screen, this.sceneTarget, ...);
  blurMediumTarget = blurSmallTarget;
  blurLargeTarget = blurMediumTarget;

  if (this.stagedStageCount >= 2) {
    blurMediumTarget = this.blurPassMedium.render(screen, this.sceneTarget, ...);
    blurLargeTarget = blurMediumTarget;
  }
  if (this.stagedStageCount >= 3) {
    blurLargeTarget = this.blurPassLarge.render(screen, this.sceneTarget, ...);
  }
}
```

`Stage Cnt = 1` では small blur だけを生成し、medium / large の入力にも small blur を渡す。`Stage Cnt = 2` では small と medium を生成し、large の入力には medium を渡す。したがって段階数 benchmark は、最終 composite shader を変えず、blur texture 生成 pass の数だけを変える実験になっている。

### 3.2 深度から blur weight を作る式

本実験では、厳密な薄レンズ式から screen-space CoC を求めているわけではない。`DofPass` は depth buffer を view 空間距離に戻し、focus distance との差分を `Focus Range` で割って stage 位置を作る。これは、物理量としての CoC ではなく、postprocess の合成量と多段階ぼかしの選択を決める正規化値である。

2026-07-02 以降の `DofPass` では、`Focus Range` を最大 blur へ到達する距離ではなく、`compute_dof` と同じく blur stage 1つ分の距離幅として扱う。composite shader 内の考え方は次の通りである。

```wgsl
fn stagePosition(focusDelta : f32, focusRange : f32) -> f32 {
  return focusDelta / max(focusRange, 0.0001);
}

fn smoothStageFraction(stageValue : f32, holdRatio : f32, power : f32) -> f32 {
  let normalizedDistance = clamp(stageValue, 0.0, 1.0);
  let hold = clamp(holdRatio, 0.0, 0.95);
  let ramp = clamp((normalizedDistance - hold) / max(1.0 - hold, 0.0001), 0.0, 1.0);
  let smoothWeight = ramp * ramp * (3.0 - 2.0 * ramp);
  return pow(smoothWeight, max(power, 0.0001));
}
```

ここで `Focus Range` は、`scene -> small`、`small -> medium`、`medium -> large` の各遷移に使う距離幅である。`Focus Hold` は各 stage の先頭で完全に sharp または前段階の blur とみなす割合であり、写真レンズの絞り値そのものではない。`Focus Hold` を大きくすると保持区間は広がるが、その外側で 0 から 1 へ上がる遷移区間は短くなる。そのため `Focus Hold = 0.95` のような値では、被写界深度が深くなって見えるというより、保持区間の外で急に次の blur へ立ち上がる。

### 3.3 多段階ぼかし

多段階ぼかしは、`SeparableBlurPass` を 3 個持ち、同じ `sceneTarget` から半径と target scale の異なる blur texture を作る。現在の設定では、基準の `blurRadius` に対して radius scale は small が `0.16`、medium が `0.55`、large が `1.0` である。target scale は small が `blurScale * 1.0`、medium が `blurScale * 0.7`、large が `blurScale * 0.5` である。標準値では、実用上扱いやすい小さめの blur として `blurRadius = 2.0` を使い、stage 別 iteration は small / medium / large を `1 / 2 / 4`、`blurScale = 1.0` とする。画面解像度に近い small blur の反復を抑え、低解像度で広い blur を作る large 側に多めの反復を割り当てる構成である。なお、強い blur 条件の 3 環境比較では、演出上の差を見やすくするため `blurRadius = 5.5` を用いた。

最終合成は、stage 位置を 3 区間へ割り当て、各区間内で `smoothStageFraction()` を使いながら `scene -> small -> medium -> large` の順に補間する。

```wgsl
fn stagedBlurColor(sceneColor : vec3f, smallBlur : vec3f, mediumBlur : vec3f, largeBlur : vec3f, stagePositionValue : f32) -> vec3f {
  let stage = clamp(stagePositionValue, 0.0, 3.0);
  if (stage < 1.0) {
    return mix(sceneColor, smallBlur, smoothStageFraction(stage, uniforms.sharpnessWidth, uniforms.sharpnessPower));
  }
  if (stage < 2.0) {
    return mix(smallBlur, mediumBlur, smoothStageFraction(stage - 1.0, uniforms.sharpnessWidth, uniforms.sharpnessPower));
  }
  return mix(mediumBlur, largeBlur, smoothStageFraction(stage - 2.0, uniforms.sharpnessWidth, uniforms.sharpnessPower));
}
```

この構成にした理由は、焦点から少し外れた領域でいきなり強い blur に飛ぶ見え方を避けるためである。以前の合成では、実質的に中間段階を十分に経由せず、大きな blur へ急に移ったように見える場面があった。現在の stage debug では、scene 色、small、medium、large のどの段階が選ばれているかを色で確認できるため、合成式の不連続と blur texture 自体の問題を分けて観察できる。

多段階ぼかしの欠点は、blur texture 生成時に depth を見ていないことである。scene 全体を先に blur し、あとから depth に応じて合成するため、焦点付近の物体の色が背景側へ漏れたり、背景の明るい色が前景へ回り込んだりする。これは方式に由来する制約であり、完全に消すには前景・背景分離や depth-aware blur などの追加処理が必要になる。

### 3.4 CoC gather

CoC gather は、blur texture を事前生成せず、composite shader 内で周辺 pixel を読む。現在の実装では 64 tap の disk gather を行い、sample 点は golden angle で円盤内へ配置する。さらに pixel ごとに hash から回転角を与え、固定方向の ring や放射 pattern がそろって見えることを抑えている。

半径は次の形で決まる。

```wgsl
let radius = max(0.0, uniforms.blurRadius) * max(0.0, uniforms.cocRadiusScale) * blurWeight;
```

各 sample では sample 先の depth も読み、sample 側の `blurWeight` を再計算する。現在 pixel より手前にあり、かつ現在 pixel より sharp な sample は混ぜない。これは、手前の sharp な物体が背景側へにじむことを抑えるための depth-aware rejection である。

```wgsl
let foreground = sampleDepth < centerDepth;
let sharperThanCenter = sampleWeight + 0.05 < centerWeight;
let allowSample = select(1.0, 0.0, foreground && sharperThanCenter);
```

この処理により、多段階ぼかしより境界制御を入れやすい。一方で、64 tap は各 pixel で color と depth を多数読むため、負荷が高い。さらに sample 数を増やしても、blur 半径の増加曲線が不自然であれば、視覚的な自然さは改善しない。したがって CoC gather は「境界を正しくしやすいが、標準経路にするには重い」方式として位置づけた。

## 4. 可視化機能

実験では、最終画像だけでは原因を切り分けられないため、次の debug view を用意した。

- `scene` は DoF 前の照明済み scene color を表示する。
- `depth` は線形化 depth を白黒で表示する。
- `focusMask` は focus 面、手前、奥を色分けする。
- `stageMask` は `scene / small / medium / large` の段階選択を色分けする。
- `blurSmall`、`blurMedium`、`blurLarge` は各 blur texture を直接表示する。

これにより、たとえば「四角柱の輪郭が急に強い blur へ変わる」場合に、blur texture の生成が問題なのか、`blurWeight` の立ち上がりが急なのか、段階合成が中間 blur を経由していないのかを分けて確認できる。今回の修正では、`stageMask` と個別 blur 表示が、多段階ぼかしの段階確認に特に有効であった。

## 5. 実験仮説

実験前の仮説は次の 3 点である。

第 1 に、標準表示では多段階ぼかしが CoC gather より安定して軽いと予想した。多段階ぼかしは blur texture を作る pass 数を持つが、large blur を低解像度 target で作れる。一方、CoC gather は 64 tap を画面全 pixel で実行するため、解像度に対する cost が大きい。

第 2 に、多段階ぼかしの段階別 cost は large blur が支配的ではないと予想した。large blur は半径こそ大きいが target scale が `0.5` であり、処理 pixel 数が減る。small blur は半径が小さい一方で target scale が `1.0` であるため、画面解像度に近い target を複数 iteration 処理する。

第 3 に、`Focus Hold` の値を大きくしても、写真レンズ的な意味で被写界深度がなだらかに深くなるとは限らないと予想した。実装上の `Focus Hold` は sharp 帯の比率であり、遷移区間を別に確保するパラメータではないためである。

## 6. GPU benchmark の方法

benchmark は `samples/dof` の CommandPalette から `Bench` を実行して取得した。実行中は view を `composite` に固定し、debug view の追加表示 cost が測定に入らないようにした。benchmark 開始時には現在の DoF 設定を保存し、各 case の切り替えは `DofPass` の通常 setter を通して行う。終了後は元の設定へ戻し、結果を JSON として download できる。

測定 case は次の 6 種類である。

| case | mode | 内容 |
| --- | --- | --- |
| `dof_off` | staged / disabled | DoF を無効化し、scene 描画と composite の基準 cost を測る |
| `staged_s1` | staged | small blur だけを生成する |
| `staged_s2` | staged | small と medium blur を生成する |
| `staged_full` | staged | small、medium、large の 3 段階を生成する |
| `staged_half` | staged | 3 段階を生成するが `blurScale = 0.5` にする |
| `coc` | coc | 多段階ぼかし用 blur pass を走らせず、64 tap gather で合成する |

標準の benchmark 設定は warmup 45 frame、sample 90 frame である。各 case は warmup の間だけ値を捨て、その後の sample 区間で `FrameTimer` の snapshot を収集する。JSON には各 case の設定、summary、sample 配列、browser 情報、canvas size、`timestamp-query` 対応有無を保存する。

GPU 時間は WebGPU の `timestamp-query` により計測する。`FrameTimer` は render pass の開始と終了に timestamp を書き込み、`queue.submit()` 後に非同期で readback する。readback 待ちで frame loop を止めないよう、3 つの query slot を循環させる。`FrameTimer` 側では GPU render time を 30 sample の移動平均として保持しており、benchmark JSON の `gpuRenderMs` は、この移動平均値を sample frame ごとに読み取った値である。したがって本稿の平均値は「timestamp の完全な raw duration の単純平均」ではなく、「FrameTimer の移動平均 snapshot を benchmark 区間で平均した値」である。この点は再現性と解釈上の制限として明示しておく。

計測対象の render 区間は、scene を offscreen に描く pass から `DofPass.render()` の composite pass までである。`samples/dof/main.js` では `onBeforeDraw` で `beginGpuTiming()` を呼び、scene pass の開始 timestamp を記録し、`onAfterDraw3d` で DoF pass の終了 timestamp を記録してから query を resolve する。したがって `gpuRenderMs` には、scene 描画、debug target 更新、多段階ぼかし pass、composite pass が含まれる。ただし debug view を画面へ再表示する追加 fullscreen pass は、benchmark 中に view を `composite` へ固定するため含まれない。

追加の iteration 削減実験は、公開済み core の `webg/DofPass.js` を変更せず、`samples/dof` を `user/dof` へ複製して実施した。`user/dof` では `DofPass` を継承した実験用 pass を作り、small / medium / large の iteration 数を個別に指定できるようにした。比較 case は、`Staged S1`、`Staged S2`、`Staged Reduced`、`Staged M3`、`Staged I6`、`Staged Half`、`CoC` である。`Staged Reduced` は `small = 1`、`medium = 2`、`large = 4`、`Staged M3` は `small = 1`、`medium = 3`、`large = 4`、`Staged I6` は `small = 6`、`medium = 6`、`large = 6` を表す。これは、small と medium の iteration を減らした場合に、見た目を保ちながら small blur 支配の cost を下げられるかを調べるための補助実験である。

## 7. 測定条件

3 環境の benchmark はいずれも `timestampSupported = true` であった。DoF の主要設定は共通で、`focusDistance = 36`、`focusRange = 13.4`、`Focus Hold = 0.35`、`blurRadius = 5.5`、`blurIterations = 6`、`cocRadiusScale = 3`、`stagedStageCount = 3` を基準にした。

| 環境 | canvas | devicePixelRatio | frame interval の目安 |
| --- | ---: | ---: | ---: |
| MacBook Pro M4 Max | 3016 x 1824 | 1.6 | 約 8.33 ms |
| Windows RTX3070 | 1139 x 895 | 1.0 | 約 16.67 ms |
| Intel 770 | 1303 x 891 | 1.0 | 約 16.67 ms、CoC 時に低下 |

canvas 解像度が一致していないため、GPU 間の絶対値をそのまま性能比較として読むべきではない。本稿で重視するのは、同一環境内での `DOF Off`、多段階ぼかし、CoC の差分と比率である。

iteration 削減実験では、MacBook Pro M4 Max 上で内部 canvas を `960 x 720` に固定した。`devicePixelRatio` は約 `1.6` であったが、描画 target は固定解像度で作成した。DoF の主要設定は、`focusDistance = 36`、`focusRange = 13.4`、`Focus Hold = 0.35`、`blurRadius = 2.0`、`cocRadiusScale = 3`、`stagedStageCount = 3` である。これは、強い演出用 blur ではなく、利用頻度が高いと判断した小さめの blur 半径で、stage 別 iteration を減らす効果を確認する条件である。

## 8. 測定結果

### 8.1 GPU render time

平均 `gpuRenderMs` は次の通りである。

| case | M4 Max | RTX3070 | Intel 770 |
| --- | ---: | ---: | ---: |
| DOF Off | 0.160 ms | 0.703 ms | 2.439 ms |
| Staged S1 | 1.155 ms | 2.216 ms | 8.949 ms |
| Staged S2 | 1.578 ms | 2.441 ms | 9.059 ms |
| Staged Full | 1.870 ms | 2.336 ms | 10.284 ms |
| Staged Half | 1.041 ms | 1.414 ms | 7.267 ms |
| CoC | 2.915 ms | 2.610 ms | 19.063 ms |

### 8.2 基準差分

`DOF Off` を基準にした追加 cost は次の通りである。

| 指標 | M4 Max | RTX3070 | Intel 770 |
| --- | ---: | ---: | ---: |
| Staged S1 - Off | +0.995 ms | +1.513 ms | +6.510 ms |
| Staged S2 - S1 | +0.423 ms | +0.225 ms | +0.111 ms |
| Staged Full - S2 | +0.292 ms | -0.105 ms | +1.225 ms |
| Staged Full - Off | +1.710 ms | +1.633 ms | +7.845 ms |
| CoC - Staged Full | +1.045 ms | +0.274 ms | +8.779 ms |

RTX3070 では `Staged Full` が `Staged S2` よりわずかに軽い。これは large blur の追加 cost が非常に小さいうえ、移動平均 snapshot と GPU scheduler の揺れが差分より大きく出た可能性がある。単調増加しないこと自体は、large blur が支配項ではないという見方を弱めるものではない。

### 8.3 比率

`Staged Full` を 1.0 としたときの比率は次の通りである。

| 指標 | M4 Max | RTX3070 | Intel 770 |
| --- | ---: | ---: | ---: |
| Staged Half / Staged Full | 0.56 | 0.61 | 0.71 |
| CoC / Staged Full | 1.56 | 1.12 | 1.85 |

`Staged Half` はすべての環境で cost を下げたが、削減率は M4 Max が最も大きく、Intel 770 が最も小さい。これは target 解像度だけでなく、texture sampling、render pass 切り替え、driver、memory bandwidth の影響も含まれるためと考えられる。

### 8.4 blurRadius 2.0 における iteration 削減

`blurRadius = 2.0`、固定 canvas `960 x 720` で取得した追加実験の平均 `gpuRenderMs` は次の通りである。

| case | stage iteration | gpuRenderMs | DOF Off との差分 |
| --- | --- | ---: | ---: |
| DOF Off | - | 0.142 ms | - |
| Staged S1 | small 1 | 0.339 ms | +0.197 ms |
| Staged S2 | small 1, medium 2 | 0.503 ms | +0.361 ms |
| Staged Reduced | small 1, medium 2, large 4 | 0.783 ms | +0.641 ms |
| Staged M3 | small 1, medium 3, large 4 | 0.842 ms | +0.700 ms |
| Staged I6 | small 6, medium 6, large 6 | 1.668 ms | +1.526 ms |
| Staged Half | small 1, medium 2, large 4, blurScale 0.5 | 0.610 ms | +0.468 ms |
| CoC | 64 tap gather | 0.549 ms | +0.408 ms |

`Staged Reduced` と比較対象の比率は次の通りである。

| 比較 | base | compare | 差分 | base / compare |
| --- | ---: | ---: | ---: | ---: |
| Reduced / M3 | 0.783 ms | 0.842 ms | +0.059 ms | 0.930 |
| Reduced / I6 | 0.783 ms | 1.668 ms | +0.885 ms | 0.469 |

この結果から、`blurRadius = 2.0` では `medium` を 2 iteration から 3 iteration へ増やしても、GPU 時間は約 `0.059 ms` 増える。比率では `medium = 2` の方が約 7.0% 軽い。視覚的に `medium = 2` で十分であるなら、`medium = 3` は標準値としては過剰である可能性が高い。

また、全 stage を 6 iteration にした `Staged I6` は `1.668 ms` であり、`Staged Reduced` の約 2.13 倍であった。すべての stage に同じ iteration を与えると、特に small / medium のように画面解像度に近い target を処理する stage で cost が膨らむ。stage ごとに必要な blur 幅と見た目の改善量が異なるため、同一 iteration を標準値にするより、stage 別に小さくする方が合理的である。

一方で、この条件では `CoC = 0.549 ms` となり、`Staged Reduced = 0.783 ms` より軽かった。これは `blurRadius = 2.0` では gather 半径が小さく、64 tap gather の texture access cost よりも、多段階ぼかしの複数 pass、複数 render target、separable blur iteration の固定 cost が相対的に大きくなったためと考えられる。したがって、強い blur では多段階ぼかしが有利である一方、実用的な小 blur では CoC gather も再評価すべきである。

## 9. 考察

### 9.1 標準経路としての多段階ぼかし

本実験の範囲では、標準経路は多段階ぼかしが妥当である。M4 Max では `Staged Full = 1.870 ms` に対して `CoC = 2.915 ms`、RTX3070 では `2.336 ms` に対して `2.610 ms`、Intel 770 では `10.284 ms` に対して `19.063 ms` であった。CoC gather は境界制御の可能性を持つが、64 tap の cost が重く、特に Intel 770 では frame budget を強く圧迫した。

一方で、多段階ぼかしが視覚的に常に正しいわけではない。blur texture は depth を見ずに scene 全体から作られるため、前景と背景の色漏れは構造的に残る。したがって多段階ぼかしを標準経路にする理由は「物理的に正しい」からではなく、「公開サンプルとして軽く、滑らかで、調整結果を理解しやすい」からである。この位置づけを明確にしておく必要がある。

### 9.2 多段階ぼかしの支配項

段階別 benchmark から、多段階ぼかしの支配項は large blur ではなく small blur である。M4 Max では `S1 - Off = +0.995 ms` に対し、medium 追加は `+0.423 ms`、large 追加は `+0.292 ms` だった。Intel 770 では small 追加が `+6.510 ms` と突出し、medium 追加は `+0.111 ms` に留まった。RTX3070 でも small 追加が最大である。

この結果は実装構成と一致する。small blur は半径こそ小さいが target scale が `1.0` で、画面解像度に近い target を separable blur の複数 iteration で処理する。large blur は半径が大きいものの target scale が `0.5` で、pixel 数が大幅に少ない。そのため「大きな blur ほど高いはず」という直感は、この実装では成り立たない。最適化するなら、まず small blur の target scale、iteration、半径、あるいは small blur を必要とする領域の限定を検討すべきである。

`blurRadius = 2.0` の追加実験は、この解釈をさらに強める。small blur は画面解像度に近い target で実行されるため、iteration を 6 から 1 へ下げる効果が大きい。medium blur も `medium = 2` で十分に見えるなら、`medium = 3` 以上は標準設定としては cost に見合わない可能性がある。blur 半径が小さい場合、iteration は「より広い範囲をぼかすため」ではなく、「同じ半径の separable blur を複数回重ねて kernel を滑らかにするため」の反復である。したがって、もともと半径の小さい small / medium では、iteration を増やしても見た目の改善は限定的になりやすい。

### 9.3 CoC gather の評価

CoC gather は、depth-aware rejection により境界制御の方向性を持つ。しかし、現在の 64 tap 実装では標準経路にするには重い。M4 Max のように高解像度でも高い throughput を持つ環境では `Staged Full` に対して約 1.56 倍、Intel 770 では約 1.85 倍になった。RTX3070 では差が小さく見えるが、それでも `Staged Full` より軽くはならなかった。

また、CoC gather の見た目は sample 数だけで決まらない。`blurWeight` の曲線が急であれば、64 tap でも焦点付近から急激に blur へ切り替わる。これはユーザ観察で問題になった点と一致する。CoC 方式を継続する場合は、tap 数の増減だけでなく、blur 半径の立ち上がり、前景・背景の重み分離、temporal accumulation や blue-noise jitter の有無を再検討する必要がある。

ただし、`blurRadius = 2.0` の追加実験では CoC gather が `Staged Reduced` より軽かった。この結果は、CoC gather を単純に「重い比較用経路」とだけ扱うべきではないことを示している。CoC gather は sample 数が固定であるため、半径が小さい条件では cost が大きく増えない。一方、多段階ぼかしは半径が小さくても複数 pass の固定 cost を持つ。標準経路を決めるには、強い blur の演出品質だけでなく、普段使いの小 blur、境界品質、pass 数、target 解像度を同時に評価する必要がある。

### 9.4 Focus Hold の設計上の問題

`Focus Hold` は、今回の実装では `focusRange` 内で完全に sharp とみなす割合である。このため、値を大きくすると sharp 帯は広がるが、blur へ移る残り区間が短くなる。写真で絞りを絞ったときのように、被写界深度が深くなり、変化もなだらかになる、という意味にはなっていない。

したがって、`Focus Hold` は実験用パラメータとしては有効だが、利用者向けの概念としては誤解を招きやすい。今後は、完全 sharp 幅と transition 幅を別パラメータに分けるか、aperture / f-stop に近い値から内部の `focusRange` と transition curve へ変換する設計が望ましい。

### 9.5 測定方法の限界

本 benchmark は実装比較には有効だが、完全な性能評価ではない。まず canvas 解像度が環境ごとに異なるため、GPU 間の絶対値比較には向かない。また `gpuRenderMs` は `FrameTimer` の 30 sample 移動平均 snapshot であり、個々の frame の raw timestamp を直接集計したものではない。これは値を読みやすくする一方で、短時間の揺れや pass 追加の小さな差分を平滑化する。

さらに、render 区間には debug target の更新が含まれる。benchmark 中の画面表示は `composite` に固定されるため debug view の再表示 pass は含まれないが、`DofPass.render()` 内の debug target 更新自体は含まれる。このため、本稿の値は「サンプルアプリ全体としての DoF 実装 cost」であり、最小構成の production DoF pass だけの cost ではない。

## 10. 結論

`samples/dof` の実験から、webg サンプルでは多段階ぼかしを標準経路にする判断が妥当であると結論づける。多段階ぼかしは depth 境界の色漏れという制約を残すが、滑らかな blur を安定して得やすく、`blurRadius = 5.5` の強い blur 条件による 3 環境比較では CoC gather より軽かった。特に Intel 770 では CoC の cost が大きく、64 tap gather を強い blur の標準にするには負荷が高い。

最も重要な実装上の知見は、多段階ぼかしの最適化対象が large blur ではなく small blur である点である。現在の large blur は低解像度 target で生成されるため、半径が大きくても支配項になりにくい。今後は small blur の生成範囲や解像度、iteration 数、あるいは focus 近傍だけに限定する方法を検討する価値がある。

さらに、実用的な `blurRadius = 2.0` では、stage ごとの iteration を `small = 1`、`medium = 2`、`large = 4` へ下げることで、全 stage 6 iteration の約 46.9% まで cost を下げられた。この結果を受け、標準実装には多段階ぼかしの stage 別 iteration を取り込む。CoC gather は小 blur 条件で `Staged Reduced` より軽い場面があったが、強い blur では表示品質と負荷のバランスが悪く、標準サンプルの設定項目として残すと判断を複雑にするため削除する。今後 CoC 系の再検討を行う場合は、標準経路に混ぜるのではなく、別の研究用 pass として分けて扱う方がよい。

また、`Focus Hold` は写真レンズの絞り感覚とは一致しておらず、利用者向け UI としては再設計が必要である。本サンプルは、単に DoF をかける例ではなく、postprocess の近似がどのような視覚的・性能的 trade-off を持つかを観察するための実験基盤として位置づけられる。
