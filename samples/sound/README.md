# sound

## 8小節の新しいBGMを試聴する

GameAudioSynthの内蔵BGMは、12種類の曲調を2曲ずつそろえた24曲です。Melodyの曲名・曲調説明は英語で表示し、同じ曲調を隣に並べています。初期選択はCafe Steps（112 BPM）です。Audio Startの後にBGM Startを押し、Melodyで曲を選ぶと冒頭と推奨BPMへ切り替わります。BPMは四分音符の速さで、選択後も調整できます。全曲は4/4拍子・8小節です。swingは拍の前半を長くし、後半を短くして演奏します。ジョギング向けは170、175、180 BPMを各2曲収録しています。譜面はwebg/GameMusicPresets.jsにあり、各行が1小節、8要素が8分音符の位置、数値がMIDI音高、nullが前の音を延ばす位置、-1が明示的な休符です。GameAudioSynth.jsが旋律・低音・和音・打楽器を演奏します。旋律は次の発音・休符・小節末までの間隔に、曲ごとのleadGate（発音時間の比率）を掛けた長さで鳴らします。AttackとDecayは合計が音価を超えると同比率で短縮し、Releaseは音価までとし、旋律では次の発音・休符までの残り時間にも収めます。setRootHzの既定220 Hzで譜面どおりの音高になり、値を変えると旋律・低音・和音を同じ比率で移調できます。打楽器の音高は固定です。音量・残響・音量包絡は既存の操作で調整できます。

旋律はローパスフィルターで強い倍音を抑え、880 Hzを超える高音を徐々に小さくしています。リズムはキック・スネア・ハイハットを曲調ごとに組み合わせ、旋律と同じBPM・swingで演奏します。Jazzは控えめ、funkやジョギング向けは拍を明確にし、バラードや穏やかな曲では打音を減らすか音量を下げています。打楽器はBGMの音量・delay・reverbに追従しますが、短い打音を保つためBGM Envelopeの影響は受けません。


24曲の旋律を、音域・モチーフ・発音位置・休符・音の長さから書き直しました。Blue RoomとEveningは低音域、Cafe StepsとDaylightは中音域、Corner QuartetとMarket Squareは比較的高めの音域を使います。funkや緊張感のある曲は短い反復、バラードは長い音と休符、Quartal Horizonは四度の跳躍で輪郭を作ります。同じ曲調の2曲も、細かく刻む曲と長く歌う曲などに分けています。曲名・推奨BPM・和音進行は維持しています。

旋律の基準音量を下げ、キック・スネア・ハイハットを強めました。Melody Volは旋律だけ、Rhythm Volは低音・和音・打楽器の倍率（0〜2、既定1）です。0にすると該当パートを消して比較でき、曲を切り替えても値を保持します。変更は次に予約する音から反映され、すでに鳴っている音や残響は自然に減衰します。BGM Volは全体音量です。

現在の譜面形式は4/4拍子・8小節・八分音符単位の単旋律です。十六分音符、独立した三連符、旋律の和音、小節をまたぐタイは記述できません。swingは八分音符の長短比率で表します。旋律は基本波形とフィルターによる合成音で、実楽器のサンプル音源ではありません。パート音量の個別設定はGameAudioSynthの譜面形式に適用され、AudioSynthの度数形式には適用されません。

| Style | Preset / BPM | Preset / BPM |
|---|---|---|
| Jazz swing | Cafe Steps · 112 | Corner Quartet · 132 |
| Blues jazz | Blue Room · 96 | Blue Alley · 104 |
| Bossa jazz | Palm Terrace · 126 | Coastal Breeze · 138 |
| Jazz ballad | Midnight Window · 72 | Velvet Rain · 78 |
| Modal jazz | Dorian Walk · 118 | Quartal Horizon · 128 |
| Jazz funk | Sunset Pocket · 108 | Electric Crosswalk · 120 |
| Jogging jazz | River Run · 170 | Boardwalk Miles · 170 |
| Jogging synth | Neon Stride · 175 | Midnight Circuit · 175 |
| Jogging pop | Sunrise Sprint · 180 | Open Road · 180 |
| Upbeat | Daylight · 124 | Market Square · 132 |
| Gentle | Evening · 84 | Moonlit Garden · 90 |
| Tense | Pursuit · 148 | Nightfall Chase · 156 |

[English](README.en.md) | 日本語

![sound](./sound.jpg)

## 概要
- AudioSynth と GameAudioSynth を使い、SE と BGM を同じ画面で調整しながら確認するサンプルです。
- Audio Start で AudioContext を開始し、Play SE、Next SE、Audition All、BGM Start を使って音を鳴らし、その場で volume、delay、reverb、envelope、melody を調整できます。
- 「何を鳴らすか」と「どう聞こえるように整えるか」を 1 画面で往復しながら確認できる構成です。

画面の見方

画面は System、Sound Effects、Background Music の 3 つに分かれています。順番に見ると、まず AudioContext を起こし、そのあと SE を調整し、最後に melody、BPM、BGM envelope、BGM reverb を直接動かして BGM の細かな輪郭を整える流れになっています。

System では Audio Start と Master Vol を扱います。Audio Start は browser の制約に合わせて user gesture の後に AudioContext を開始するためのボタンです。Master Vol は全体音量の基準です。ここを最初に整えると、SE と BGM の相対バランスを見やすくなります。

Sound Effects では、Sound Effect で鳴らす効果音を選び、Play SE で再生します。Next SE は catalog を 1 件ずつ進めて、Audition All は全件を順番に鳴らして差を聞き比べるためのボタンです。SE Profiles はその効果音が使う envelope profile の一覧、Editing Profile は今 slider で編集している profile 名です。SE Vol、SE Delay、SE Reverb、SE Reverb Kind、SE Reverb Length、SE Reverb Decay、SE Envelope、SE Attack、SE Decay、SE Sustain、SE Release を使うと、同じ効果音でも輪郭や空間感をかなり細かく変えられます。

Background Music では、BGM Start と BGM Stop、BGM Vol、BPM、Melody、BGM Delay、BGM Reverb、BGM Reverb Kind、BGM Reverb Length、BGM Reverb Decay、BGM Attack、BGM Decay、BGM Sustain、BGM Release を扱います。BGM は melody と BPM で進行そのものが変わるので、SE とは少し違って、時間の流れを聞きながら調整するのが向いています。

## 実行方法
- 実行ファイルは [./sound.html](./sound.html) です
- WebGPU に対応したブラウザで開き、必要に応じて help panel や HUD と合わせて確認してください

## 使用している webg 機能
- GameAudioSynth: ゲーム向けの効果音 catalog と melody preset をまとめて扱う
- AudioSynth: SE/BGM の envelope、delay、reverb、IR 設定を担当する

## 効果音の合成を聞き比べる

18種類の効果音は、短いノイズ、低い胴鳴り、連続した音高変化、通知のフレーズを組み合わせています。paddleとwallは短い衝突、blockは破片、baanは爆発、shupaは空気の流れ、laserは下降する音です。poyoon、piyoon、jumpは滑らかな音高変化、coin、levelup、powerupは安定した音程と和音、gameoverは下降するフレーズで区別します。ui_moveとui_okは連打を考慮した短く控えめな音です。Play SEで選択した効果音を試聴できます。

ノイズにもSE Envelopeの各プロフィールが適用されます。SE Profilesは実際に使う層から生成し、Editing Profileで選んだ包絡を次の発音へ反映します。短い層ではAttackとDecayを発音時間内へ収めて演奏し、Releaseは指定した値を使います。tail_probeは短いノイズと長い音を含み、包絡と残響の比較に使えます。

Audition Allは、各音の発音と現在のReleaseが終わる時刻に0.15秒を加えて次の効果音へ進みます。BGMを流したまま、衝突音や操作音が聞き分けられるかも確認できます。ディレイとリバーブの余韻は試聴の待ち時間に含みません。

## 確認ポイント
最初にやることは Audio Start です。これで音を出せる状態にしてから、Sound Effect と Play SE で短い効果音を確認し、BGM Start でメロディを流します。音の輪郭を見たいときは SE Envelope、空間感を見たいときは SE Reverb Kind と SE Reverb Length と SE Reverb Decay、BGM の流れを見たいときは Melody と BPM を動かします。

このサンプルでは、SE Dry / SE Reverb Max と BGM Dry / BGM Wet という比較用の固定ボタンも用意しています。slider の中間値だけだと違いが分かりにくいときは、いったん極端な状態に振ってから戻すと、変化の方向がつかみやすくなります。

SE Reverb Kind と BGM Reverb Kind は room、hall、plate を切り替えます。残響の性格を選ぶ設定です。Length は IR の長さ、Decay は減衰の早さを表します。短めで締まった room から、長く広がる hall まで、連続的に聞き比べることができます。

SE Envelope は、選んだ効果音が使う envelope profile を切り替える場所です。profile 名は percussion、brass、woodwind、organ、piano、guitar のような楽器カテゴリになっており、打撃音、吹奏感、持続音、弦を弾いた音のような時間変化を比較できます。SE Attack、SE Decay、SE Sustain、SE Release を動かすと、次に鳴るその profile の音が変わります。短い効果音は差が分かりにくいことがあるので、tail_probe を選ぶと、前半の輪郭音と後半の余韻の両方で違いを聞き取りやすくなります。

BGM Envelope は、BGM の一音一音の立ち上がりと余韻を決めます。BGM Attack、BGM Decay、BGM Sustain、BGM Release を動かすと、同じ melody でも印象が変わります。BPM は進む速さ、Melody は旋律の形を変えるので、BGM は「何を鳴らすか」と「どう進むか」を別々に見ると調整しやすいです。BGM 側の reverb は SE より少し強めの hall 既定にしてあるので、Audition All で melody を流したときに、フレーズの尾が長めに残る感触を先に掴みやすくしています。

まず Audio Start を押して、Play SE、Next SE、Audition All、BGM Start が有効になることを確認します。次に Sound Effect を切り替え、SE Profiles と Editing Profile が選んだ音に合わせて変わることを確認します。そのうえで SE Attack、SE Decay、SE Sustain、SE Release と SE Reverb を動かし、同じ効果音を鳴らし直して差を聞き比べます。

Audition All を押したときは、catalog 全体が順番に鳴ることを確認します。途中で止めたくなったら同じボタンを押して止められます。Next SE は 1 件ずつ進むので、気になった効果音をもう 1 度鳴らしたいときに便利です。

SE Reverb Kind を room、hall、plate で切り替えると、同じ wet 量でも反射の質感が変わります。SE Reverb Length と SE Reverb Decay を変えると、残響の長さと落ち方が変わります。tail_probe を選ぶと、短い効果音よりも envelope と reverb tail の違いが追いやすくなります。

BGM 側では Melody を変えながら BPM と BGM Envelope を調整し、同じ音源でも印象がどう変わるかを確認します。BGM Reverb Kind、BGM Reverb Length、BGM Reverb Decay を動かすと、同じ旋律でも空間の広がり方が変わることが分かります。初期値は hall 寄りで少し強めにしてあるので、まずはそのまま鳴らしてから dry 側へ戻すと差が分かりやすいです。

## 操作方法
このサンプルは画面上の UI ボタンと slider で操作します。

Audio Start は AudioContext の開始、BGM Start / BGM Stop は BGM の開始と停止、Play SE は選択中の効果音を 1 回鳴らすボタンです。SE Dry / SE Reverb Max と BGM Dry / BGM Wet は比較用の固定状態へ切り替えるボタンです。

つまずきやすい点

Audio Start を押していないと、音は鳴りません。これは browser の制約に合わせた動きです。まず AudioContext を開始してから、他のボタンを押してください。

SE Reverb と SE Reverb Kind は別の設定です。SE Reverb は残響の量、Kind は残響の性格です。BGM 側も同じで、BGM Reverb は量、BGM Reverb Kind は性格です。

SE Attack や BGM Attack は秒、SE Sustain や BGM Sustain は比率です。単位が違うので、slider を動かすときは表示値も一緒に見ると分かりやすいです。

関連文書

- [14_UI表示の設計.md](../../book/14_UI表示の設計.md)
- [16_サウンドの設計.md](../../book/16_サウンドの設計.md)
- [01_はじめに.md](../../book/01_はじめに.md)
- [samples/sound/main.js](./main.js)
- [samples/sound/sound.html](./sound.html)

16_サウンドの設計.md は実装の詳しい説明、01_はじめに.md はプロジェクト全体の入口です。この README.md は、サンプルの画面をどう触るかに集中した案内として読むと分かりやすくなります。
