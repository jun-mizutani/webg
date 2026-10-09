// GameMusicPresets.js 2026/10/02
// 12種類の曲調を2曲ずつ収録する8小節の譜面。1小節8個のMIDI音高、null（音を延ばす）、-1（休符）で記述する
// swingは1拍の前半の割合。和音は低い根音から順に並べ、grooveが伴奏の発音位置を決める
// leadGainは旋律の基準音量、leadGateは音符間隔に対する発音時間の比率。
export const GAME_MUSIC_PRESETS = {
  jazz_cafe: {
    label: "Cafe Steps — Jazz swing / 112 BPM", bpm:112, type:"sine", groove:"walk", swing:.62,
    chords:[[50,53,57,60],[43,47,53,57],[48,52,55,59],[45,49,55,60],[50,53,57,60],[43,47,53,56],[48,52,55,59],[43,47,53,57]],
    // 中音域の短い問いと応答、裏拍からの入り
    leadGain:0.032, leadGate:0.78,
    lead:[[-1,65,69,null,67,65,-1,62],
      [-1,65,67,71,null,69,-1,-1],
      [64,null,67,71,69,null,-1,67],
      [-1,61,64,null,67,64,61,-1],
      [65,null,69,72,null,69,67,65],
      [-1,65,68,null,71,68,-1,-1],
      [67,null,71,74,72,null,67,64],
      [-1,65,62,null,59,62,64,-1]]
  },
  jazz_corner: {
    label:"Corner Quartet — Jazz swing / 132 BPM", bpm:132, type:"triangle", groove:"walk", swing:.61,
    chords:[[53,57,60,64],[50,54,57,60],[43,46,50,53],[48,52,58,62],[45,48,52,55],[50,54,57,60],[43,46,50,53],[48,52,58,61]],
    // 上向きの跳躍と下降する応答、短い八分音符
    leadGain:0.032, leadGate:0.67,
    lead:[[69,72,-1,77,76,72,69,-1],
      [-1,66,69,72,-1,78,76,72],
      [70,74,77,-1,74,70,67,-1],
      [-1,70,74,76,79,null,76,74],
      [72,76,79,-1,76,72,69,-1],
      [69,-1,72,78,76,74,72,-1],
      [-1,70,74,77,76,74,70,-1],
      [74,null,73,70,67,null,-1,-1]]
  },
  jazz_blue_room: {
    label:"Blue Room — Blues jazz / 96 BPM", bpm:96, type:"sine", groove:"walk", swing:.64,
    chords:[[48,52,55,58],[41,45,48,51],[48,52,55,58],[48,52,55,58],[41,45,48,51],[42,45,48,51],[48,52,55,57],[43,47,50,53]],
    // 低音域のブルース、同音反復とフレーズ間の休符
    leadGain:0.034, leadGate:0.76,
    lead:[[60,null,60,63,64,null,-1,-1],
      [60,null,57,null,-1,56,57,-1],
      [60,null,63,64,67,null,66,65],
      [63,null,60,null,-1,-1,-1,-1],
      [65,null,63,60,57,null,-1,-1],
      [60,63,66,null,63,60,-1,-1],
      [64,null,63,60,57,null,-1,-1],
      [59,null,62,65,62,null,59,-1]]
  },
  jazz_blue_alley: {
    label:"Blue Alley — Blues jazz / 104 BPM", bpm:104, type:"triangle", groove:"walk", swing:.63,
    chords:[[53,57,60,63],[46,50,53,56],[53,57,60,63],[50,54,57,60],[43,46,50,53],[48,52,55,58],[53,57,60,62],[48,52,55,58]],
    // 高めのブルース応答、半音の装飾と切れのある終止
    leadGain:0.033, leadGate:0.62,
    lead:[[-1,68,69,72,75,null,74,72],
      [70,null,68,65,-1,68,70,-1],
      [-1,68,69,72,77,75,72,-1],
      [69,72,75,null,74,72,69,-1],
      [70,null,67,65,-1,67,70,72],
      [-1,70,72,75,76,75,72,-1],
      [69,null,72,74,72,null,69,-1],
      [70,69,67,64,60,null,-1,-1]]
  },
  jazz_bossa: {
    label:"Palm Terrace — Bossa jazz / 126 BPM", bpm:126, type:"sine", groove:"bossa", swing:.5,
    chords:[[53,57,60,64],[50,53,57,60],[43,46,50,53],[48,52,58,62],[53,57,60,64],[46,50,53,57],[43,46,50,53],[48,52,58,61]],
    // 長短を交互にした中音域の歌、拍頭を避ける
    leadGain:0.032, leadGate:0.86,
    lead:[[-1,69,null,null,72,null,76,null],
      [72,null,-1,69,null,65,null,null],
      [-1,70,null,69,null,67,65,null],
      [64,null,null,-1,67,null,70,null],
      [-1,69,null,null,77,null,76,null],
      [74,null,-1,72,null,69,null,null],
      [67,null,null,70,null,74,72,null],
      [70,null,67,null,64,null,-1,-1]]
  },
  jazz_coast: {
    label:"Coastal Breeze — Bossa jazz / 138 BPM", bpm:138, type:"triangle", groove:"bossa", swing:.5,
    chords:[[48,52,55,59],[45,48,52,55],[50,53,57,60],[43,47,53,57],[40,43,47,50],[45,49,55,59],[50,53,57,60],[43,47,53,56]],
    // 下降する三音モチーフ、軽いシンコペーション
    leadGain:0.033, leadGate:0.72,
    lead:[[71,null,-1,67,64,null,-1,67],
      [69,null,-1,64,60,null,-1,64],
      [72,null,69,-1,65,null,62,-1],
      [71,null,-1,69,65,null,62,-1],
      [67,null,-1,64,62,null,-1,59],
      [73,null,71,-1,67,null,64,-1],
      [74,null,-1,72,69,null,65,-1],
      [71,null,69,65,62,null,-1,-1]]
  },
  jazz_midnight: {
    label:"Midnight Window — Jazz ballad / 72 BPM", bpm:72, type:"sine", groove:"ballad", swing:.56,
    chords:[[51,55,58,62],[48,51,55,58],[53,56,60,63],[46,50,56,60],[51,55,58,62],[56,60,63,67],[53,56,60,63],[46,50,56,59]],
    // 低めの長い歌い回し、二小節ごとの呼吸
    leadGain:0.031, leadGate:0.9,
    lead:[[62,null,null,null,65,null,67,null],
      [63,null,null,null,-1,-1,-1,-1],
      [65,null,null,68,72,null,null,null],
      [70,null,65,null,62,null,-1,-1],
      [67,null,null,null,70,null,72,null],
      [67,null,null,null,64,null,-1,-1],
      [68,null,null,65,63,null,null,null],
      [62,null,null,null,59,null,-1,-1]]
  },
  jazz_velvet: {
    label:"Velvet Rain — Jazz ballad / 78 BPM", bpm:78, type:"triangle", groove:"ballad", swing:.55,
    chords:[[46,50,53,57],[43,46,50,53],[48,51,55,58],[41,45,51,55],[46,50,53,57],[51,55,58,62],[48,51,55,58],[41,45,51,54]],
    // 中高音域の下降線、四分音符中心の余白
    leadGain:0.032, leadGate:0.86,
    lead:[[77,null,74,null,72,null,69,null],
      [70,null,null,null,-1,-1,67,null],
      [75,null,null,null,72,null,67,null],
      [69,null,67,null,65,null,-1,-1],
      [74,null,null,null,77,null,76,null],
      [75,null,72,null,67,null,null,null],
      [70,null,null,null,-1,67,65,null],
      [69,null,null,null,66,null,-1,-1]]
  },
  jazz_modal: {
    label:"Dorian Walk — Modal jazz / 118 BPM", bpm:118, type:"triangle", groove:"bossa", swing:.5,
    chords:[[50,53,57,60],[50,53,57,64],[50,55,57,60],[50,53,57,64],[51,54,58,61],[51,54,58,65],[50,53,57,60],[50,55,57,64]],
    // Dorianの六度を目印にした狭い音域の反復
    leadGain:0.033, leadGate:0.82,
    lead:[[62,null,69,null,71,null,-1,-1],
      [65,null,64,62,69,null,71,null],
      [67,null,69,null,74,null,71,null],
      [69,null,null,null,-1,65,64,-1],
      [63,null,70,null,72,null,-1,-1],
      [66,null,65,63,70,null,72,null],
      [69,null,71,null,74,null,72,71],
      [69,null,67,null,64,null,62,null]]
  },
  jazz_quartal: {
    label:"Quartal Horizon — Modal jazz / 128 BPM", bpm:128, type:"sine", groove:"bossa", swing:.5,
    chords:[[45,50,55,60],[45,48,55,59],[45,50,55,60],[45,48,55,59],[48,53,58,63],[48,51,58,62],[45,50,55,60],[45,48,55,59]],
    // 四度跳躍の広い輪郭、各小節後半の空白
    leadGain:0.03, leadGate:0.74,
    lead:[[57,null,62,null,67,null,-1,-1],
      [59,null,64,null,69,null,-1,-1],
      [-1,62,67,null,72,null,77,null],
      [76,null,71,null,64,null,-1,-1],
      [60,null,65,null,70,null,-1,-1],
      [62,null,67,null,72,null,-1,-1],
      [79,null,74,null,69,null,62,null],
      [71,null,64,null,59,null,-1,-1]]
  },
  jazz_sunset: {
    label:"Sunset Pocket — Jazz funk / 108 BPM", bpm:108, type:"triangle", groove:"funk", swing:.5,
    chords:[[40,43,47,50],[45,49,52,55],[38,42,45,49],[43,47,50,54],[40,43,47,50],[45,49,52,55],[42,45,48,52],[47,51,54,57]],
    // 低めの短い反復、休符でバックビートを空ける
    leadGain:0.036, leadGate:0.48,
    lead:[[59,-1,-1,62,64,-1,62,-1],
      [61,-1,-1,64,-1,67,64,-1],
      [57,-1,57,-1,61,-1,64,-1],
      [-1,62,-1,66,69,-1,66,-1],
      [59,-1,-1,62,64,62,-1,-1],
      [61,-1,64,-1,-1,67,64,-1],
      [-1,60,-1,64,66,-1,64,-1],
      [63,-1,-1,66,63,-1,59,-1]]
  },
  jazz_electric: {
    label:"Electric Crosswalk — Jazz funk / 120 BPM", bpm:120, type:"square", groove:"funk", swing:.5,
    chords:[[38,41,45,48],[43,47,50,53],[48,52,55,59],[45,49,52,55],[38,41,45,48],[41,45,48,52],[40,43,46,50],[45,49,52,55]],
    // 裏拍の跳躍と同音反復、funkの切れを強調
    leadGain:0.021, leadGate:0.56,
    lead:[[-1,62,62,-1,69,-1,65,-1],
      [-1,65,-1,71,74,-1,71,-1],
      [64,-1,64,67,-1,71,76,-1],
      [-1,64,-1,69,73,-1,69,-1],
      [-1,62,62,-1,65,-1,69,65],
      [64,-1,-1,69,72,-1,69,-1],
      [-1,62,-1,67,70,-1,67,-1],
      [64,-1,69,-1,73,69,-1,-1]]
  },
  run_swing: {
    label:"River Run — Jogging jazz / 170 BPM", bpm:170, type:"triangle", groove:"walk", swing:.60,
    chords:[[50,53,57,60],[43,47,53,57],[48,52,55,59],[45,49,55,59],[50,53,57,60],[43,47,53,56],[48,52,55,59],[43,47,53,57]],
    // 短い三音モチーフを展開する中音域の走る旋律
    leadGain:0.034, leadGate:0.64,
    lead:[[62,65,69,-1,65,69,72,-1],
      [62,65,67,-1,65,67,71,-1],
      [64,67,71,-1,67,71,74,-1],
      [61,64,67,-1,64,67,71,-1],
      [65,69,72,-1,69,72,77,-1],
      [65,68,71,-1,68,71,74,-1],
      [64,67,72,-1,71,67,64,-1],
      [65,62,59,-1,62,null,-1,-1]]
  },
  run_boardwalk: {
    label:"Boardwalk Miles — Jogging jazz / 170 BPM", bpm:170, type:"triangle", groove:"walk", swing:.59,
    chords:[[53,57,60,64],[50,54,57,60],[43,46,50,53],[48,52,58,62],[53,57,60,64],[46,50,53,57],[43,46,50,53],[48,52,58,61]],
    // 高めの四分音符主体のフック、短い応答を挟む
    leadGain:0.032, leadGate:0.76,
    lead:[[77,null,72,null,69,72,77,-1],
      [78,null,74,null,72,69,66,-1],
      [77,null,74,null,70,74,77,-1],
      [76,null,79,null,74,null,-1,-1],
      [81,null,77,null,72,77,81,-1],
      [77,null,74,null,72,69,70,-1],
      [79,null,77,null,74,70,69,-1],
      [76,null,73,null,72,null,-1,-1]]
  },
  run_neon: {
    label:"Neon Stride — Jogging synth / 175 BPM", bpm:175, type:"square", groove:"run", swing:.5,
    chords:[[45,48,52],[41,45,48],[48,52,55],[43,47,50],[45,48,52],[41,45,48],[43,47,50],[40,44,47]],
    // 中音域の反復シンセフック、リズムを前へ出す
    leadGain:0.021, leadGate:0.5,
    lead:[[69,-1,69,72,-1,69,76,-1],
      [65,-1,65,69,-1,65,72,-1],
      [67,-1,67,72,-1,67,76,-1],
      [67,-1,67,71,-1,67,74,-1],
      [69,-1,72,69,-1,76,72,-1],
      [65,-1,69,65,-1,72,69,-1],
      [67,-1,71,67,-1,74,71,-1],
      [68,-1,71,68,-1,64,60,-1]]
  },
  run_midnight: {
    label:"Midnight Circuit — Jogging synth / 175 BPM", bpm:175, type:"square", groove:"run", swing:.5,
    chords:[[40,43,47],[48,52,55],[43,47,50],[38,42,45],[40,43,47],[45,48,52],[48,52,55],[47,51,54]],
    // 低音域の持続と刻みを交互にした暗いフック
    leadGain:0.021, leadGate:0.58,
    lead:[[59,null,-1,59,64,-1,67,-1],
      [60,null,-1,60,64,-1,67,-1],
      [59,null,-1,62,67,-1,71,-1],
      [57,null,-1,57,62,-1,66,-1],
      [59,59,-1,64,67,null,-1,-1],
      [60,60,-1,64,69,null,-1,-1],
      [64,null,67,-1,72,null,71,-1],
      [63,null,66,-1,71,null,59,-1]]
  },
  run_sunrise: {
    label:"Sunrise Sprint — Jogging pop / 180 BPM", bpm:180, type:"triangle", groove:"run", swing:.5,
    chords:[[50,54,57],[45,49,52],[47,50,54],[43,47,50],[50,54,57],[43,47,50],[45,49,52],[50,54,57]],
    // 順次進行の明るい歌、四小節単位で上昇する
    leadGain:0.034, leadGate:0.78,
    lead:[[66,null,67,69,71,null,69,-1],
      [69,null,68,66,64,null,-1,-1],
      [66,null,69,71,74,null,73,71],
      [71,null,69,67,66,null,-1,-1],
      [69,null,71,74,78,null,76,74],
      [74,null,76,79,78,null,74,-1],
      [73,null,71,69,68,null,69,73],
      [74,null,78,81,78,null,74,-1]]
  },
  run_open_road: {
    label:"Open Road — Jogging pop / 180 BPM", bpm:180, type:"sine", groove:"run", swing:.5,
    chords:[[43,47,50],[38,42,45],[40,43,47],[48,52,55],[43,47,50],[48,52,55],[38,42,45],[43,47,50]],
    // 中音域の長い跳躍、走る伴奏に浮かぶ広い歌
    leadGain:0.032, leadGate:0.87,
    lead:[[67,null,null,null,74,null,71,null],
      [66,null,null,null,69,null,-1,-1],
      [67,null,null,71,76,null,74,null],
      [72,null,null,null,67,null,-1,-1],
      [71,null,null,null,79,null,78,null],
      [76,null,null,74,72,null,67,null],
      [69,null,null,null,66,null,62,null],
      [67,null,null,null,71,null,74,null]]
  },
  music_daylight: {
    label: "Daylight — Upbeat / C major / 124 BPM", bpm: 124, type:"triangle", groove: "basic", swing: .5,
    chords: [[48,52,55],[43,50,55],[45,48,52],[41,48,53],[48,52,55],[45,48,53],[43,47,50],[48,52,55]],
    // 中音域の覚えやすい反復、後半で一度だけ頂点を作る
    leadGain:0.034, leadGate:0.75,
    lead:[[64,null,67,null,64,62,60,-1],
      [62,null,67,null,71,null,-1,-1],
      [64,null,69,null,67,64,60,-1],
      [65,null,64,null,62,null,-1,-1],
      [64,null,67,72,76,null,74,72],
      [69,null,65,null,64,62,60,-1],
      [62,null,67,null,65,62,59,-1],
      [60,null,null,null,-1,-1,-1,-1]]
  },
  music_market: {
    label:"Market Square — Upbeat / F major / 132 BPM", bpm:132, type:"triangle", groove:"basic", swing:.5,
    chords:[[53,57,60],[48,52,55],[50,53,57],[46,50,53],[53,57,60],[43,46,50],[48,52,55],[53,57,60]],
    // 跳ねる八分音符と上向きの分散音型
    leadGain:0.033, leadGate:0.6,
    lead:[[65,69,72,-1,69,72,77,-1],
      [-1,67,72,76,72,-1,67,-1],
      [65,69,74,-1,72,69,65,-1],
      [70,74,77,-1,74,70,65,-1],
      [69,72,77,-1,81,null,79,77],
      [70,67,62,-1,65,67,70,-1],
      [64,67,72,-1,76,72,67,-1],
      [69,null,65,null,-1,-1,-1,-1]]
  },
  music_evening: {
    label: "Evening — Gentle / C major / 84 BPM", bpm: 84, type:"sine", groove: "basic", swing: .5,
    chords: [[48,52,55,59],[45,48,52,55],[41,45,48,52],[43,47,50,53],[48,52,55,59],[41,45,48,52],[43,47,50,53],[48,52,55,59]],
    // 低音域の静かな二小節フレーズ、長い休符
    leadGain:0.03, leadGate:0.9,
    lead:[[60,null,null,null,64,null,null,null],
      [57,null,null,null,-1,-1,-1,-1],
      [60,null,null,null,65,null,64,null],
      [62,null,null,null,59,null,-1,-1],
      [64,null,null,null,67,null,69,null],
      [65,null,null,null,60,null,-1,-1],
      [62,null,null,null,59,null,null,null],
      [60,null,null,null,-1,-1,-1,-1]]
  },
  music_moonlit: {
    label:"Moonlit Garden — Gentle / G major / 90 BPM", bpm:90, type:"triangle", groove:"basic", swing:.5,
    chords:[[43,47,50,54],[40,43,47,50],[48,52,55,59],[38,42,45,48],[43,47,50,54],[45,48,52,55],[38,42,45,48],[43,47,50,54]],
    // 中音域の下降する歌、拍頭の休符と三音の応答
    leadGain:0.031, leadGate:0.84,
    lead:[[-1,-1,74,null,71,null,67,null],
      [64,null,null,null,-1,67,71,null],
      [-1,-1,76,null,72,null,67,null],
      [66,null,null,null,64,null,-1,-1],
      [-1,-1,74,null,76,74,71,null],
      [72,null,null,null,69,null,64,null],
      [66,null,69,null,72,null,69,null],
      [67,null,null,null,-1,-1,-1,-1]]
  },
  music_pursuit: {
    label: "Pursuit — Tense / A minor / 148 BPM", bpm: 148, type:"square", groove: "basic", swing: .5,
    chords: [[45,48,52],[41,45,48],[38,41,45],[40,44,47],[45,48,52],[41,45,48],[40,44,47],[45,48,52]],
    // 低めの執拗な同音反復、短い音と半音の緊張
    leadGain:0.022, leadGate:0.45,
    lead:[[57,-1,57,60,57,-1,64,-1],
      [57,-1,57,60,65,-1,64,-1],
      [57,-1,57,62,65,-1,62,-1],
      [56,-1,59,-1,64,-1,68,-1],
      [57,57,-1,60,64,-1,69,-1],
      [60,-1,60,65,69,-1,65,-1],
      [59,-1,64,-1,68,71,68,-1],
      [69,-1,64,-1,60,-1,57,-1]]
  },
  music_nightfall: {
    label:"Nightfall Chase — Tense / D minor / 156 BPM", bpm:156, type:"square", groove:"basic", swing:.5,
    chords:[[38,41,45],[46,50,53],[43,46,50],[45,49,52],[38,41,45],[46,50,53],[45,49,52],[38,41,45]],
    // 中音域の下降シーケンス、長短を交互にした追跡フレーズ
    leadGain:0.021, leadGate:0.62,
    lead:[[74,null,69,65,-1,62,65,-1],
      [77,null,74,70,-1,65,70,-1],
      [74,null,70,67,-1,62,67,-1],
      [73,null,69,64,-1,61,64,-1],
      [77,null,74,69,-1,65,62,-1],
      [74,77,-1,74,70,null,-1,65],
      [76,null,73,69,-1,64,61,-1],
      [74,null,69,65,62,null,-1,-1]]
  }
};
