// ---------------------------------------------
//  karakuri_shared.js  2026/09/10
//   Shared language, file control, and status helpers for Karakuri Maker/Player
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

const TEXT = {
  ja: {
    maker: "つくる",
    player: "からくりプレイヤー",
    makerIntro: "ぶひんをおいて、ためして、からくりをつくろう。",
    playerIntro: "SceneYAMLに書かれたからくりを動かします。球が発射され、レールと板に当たって進みます。",
    previewNote: "空いているところをクリックすると、そこに置く場所のマークが出ます。2Dと3Dを切り替えて見られます。",
    emitterNote: "発射間隔と画面に残す球の数はSceneYAMLのemittersに保存されます。",
    cameraNote: "マウスドラッグで視点を動かし、ホイールで近づいたり遠ざかったりできます。",
    sceneNote: "Makerで保存したSceneYAMLは「シーンを開く」から試せます。",
    home: "からくりホーム",
    upload: "ひらく",
    download: "しまう",
    downloadGzip: "小さくしまう",
    initialSceneSaved: "しまった配置を初期配置にしました。",
    sceneSaved: "作品をしまいました。初期配置はそのままです。",
    resetScene: "初期配置に戻す",
    resetSceneConfirm: "今の作品を初期配置に戻します。保存していない変更は手放します。続けますか？",
    resetSceneDone: "初期配置に戻しました。",
    playerLink: "あそぶ",
    makerLink: "つくる",
    start: "スタート",
    stop: "ストップ",
    reset: "リセット",
    addBox: "はこを置く",
    addSphere: "ボールを置く",
    addCapsule: "カプセルを置く",
    addEmitter: "ボールの発射台を置く",
    view2d: "2D",
    view3d: "3D",
    selected: "えらんだもの",
    marker: "ここに置く",
    move: "動かす",
    rotate: "回す",
    details: "くわしく設定",
    deleteObject: "けす",
    closeDetails: "設定を閉じる",
    objectPlaced: "マークの場所に置きました",
    objectDeleted: "けしました",
    objectMoved: "動かしました",
    deleteBlocked: "つながっている設定があるため、先にそれを外してください",
    localSceneStorageError: "作ったシーンをあそぶ画面へ渡せませんでした",
    noSelection: "画面のものをクリックすると選べます",
    save: "保存",
    idLabel: "名前",
    shapeLabel: "かたち",
    material: "見た目",
    physics: "動き方",
    shapeBox: "はこ",
    shapeSphere: "ボール",
    shapeCapsule: "カプセル",
    static: "とまる",
    displayOnly: "見た目だけ",
    kinematic: "操作で動く",
    dynamic: "落ちて動く",
    position: "場所 X / Y / Z",
    color: "色",
    roughness: "ざらざら度",
    mass: "重さ",
    emitter: "発射台",
    emitterDetails: "発射台の設定",
    emitterPosition: "出す場所 X / Y / Z",
    emitterInterval: "出る間隔（秒）",
    emitterMax: "画面に出す数",
    emitterSelectedHint: "発射台をつかんで動かせるよ。出る間隔も変えられるよ。",
    emitterPlaced: "発射台を置きました",
    statusReady: "準備できました",
    statusLoading: "読み込み中です…",
    statusError: "エラーがありました",
    speed: "速度",
    language: "English",
    undo: "ひとつ もどす",
    try: "ためす",
    workbench: "こうさく台",
    modeEdit: "つくっているよ",
    modePlaying: "ためしているよ",
    modePaused: "とめて見ているよ",
    pause: "とめる",
    resume: "つづける",
    restart: "はじめから",
    backEdit: "なおす",
    stageHint: "下のぶひんをえらんで、画面の おきたい場所をおしてね。",
    selectionHint: "つかんでうごかせるよ",
    tiltLeft: "↶ ひだり",
    tiltRight: "↷ みぎ",
    duplicate: "もうひとつ",
    remove: "はずす",
    parts: "ぶひん",
    partBall: "ボール",
    partRamp: "さか",
    partBlock: "つみき",
    partDomino: "ドミノ 6こ",
    partGoal: "ゴール",
    partLauncher: "ボールをだす",
    adultSettings: "おとなの設定",
    technicalEditor: "部品の詳しい設定",
    placedHint: "画面の おきたい場所をおすと、ぶひんをおけるよ。",
    rampGuide: "つみきの上に置こう",
    rampPlaced: "つみきの上に坂をそろえました。",
    dominoArranged: "6このドミノを置きました。",
    goalWaiting: "ボールをゴールへ とどけよう。",
    goalReached: "とどいた！",
    tryHint: "動きを見てみよう。",
    pausedHint: "とめて見ているよ。「なおす」で工夫を続けよう。",
    backEditHint: "配置を変えて、もう一度ためせるよ。",
    selectedPartHint: "つかんでうごかせるよ。↶↷でかたむきを変えられるよ。",
    undone: "ひとつ前の工作へ戻しました。",
    duplicated: "もうひとつ置きました。",
    removed: "部品をはずしました。"
  },
  en: {
    maker: "Make",
    player: "Karakuri Player",
    makerIntro: "Place parts, try your machine, and make it better.",
    playerIntro: "Play the machine described by SceneYAML. Balls appear, touch the rail and boards, and move through the scene.",
    previewNote: "Click an empty place to show a marker. Switch between 2D and 3D to look at your machine.",
    emitterNote: "The interval and number of balls on screen are stored in SceneYAML emitters.",
    cameraNote: "Drag to orbit the camera. Use the wheel to zoom in and out.",
    sceneNote: "Open a SceneYAML saved by Maker with Open scene.",
    home: "Karakuri Home",
    upload: "Open",
    download: "Save",
    downloadGzip: "Save small",
    initialSceneSaved: "The saved layout is now the starting layout.",
    sceneSaved: "The work was saved. The starting layout stays the same.",
    resetScene: "Use starting layout",
    resetSceneConfirm: "This will replace the current work with the starting layout. Unsaved changes will be discarded. Continue?",
    resetSceneDone: "Returned to the starting layout.",
    playerLink: "Play",
    makerLink: "Make",
    start: "Start",
    stop: "Stop",
    reset: "Reset",
    addBox: "Add box",
    addSphere: "Add ball",
    addCapsule: "Add capsule",
    addEmitter: "Add ball launcher",
    view2d: "2D",
    view3d: "3D",
    selected: "Selected item",
    marker: "Place here",
    move: "Move",
    rotate: "Turn",
    details: "More settings",
    deleteObject: "Delete",
    closeDetails: "Close settings",
    objectPlaced: "Placed at the marker",
    objectDeleted: "Deleted",
    objectMoved: "Moved",
    deleteBlocked: "This item is still used by another setting",
    localSceneStorageError: "The made scene could not be passed to Play",
    noSelection: "Click an object to choose it",
    save: "Save",
    idLabel: "Name",
    shapeLabel: "Shape",
    material: "Look",
    physics: "Motion",
    shapeBox: "Box",
    shapeSphere: "Ball",
    shapeCapsule: "Capsule",
    static: "Fixed",
    displayOnly: "Display only",
    kinematic: "Moved by controls",
    dynamic: "Moved by physics",
    position: "Position X / Y / Z",
    color: "Color",
    roughness: "Roughness",
    mass: "Mass",
    emitter: "Ball launcher",
    emitterDetails: "Ball launcher settings",
    emitterPosition: "Spawn position X / Y / Z",
    emitterInterval: "Interval (seconds)",
    emitterMax: "Balls on screen",
    emitterSelectedHint: "Drag the launcher to move it. You can change its interval too.",
    emitterPlaced: "Placed the launcher",
    statusReady: "Ready",
    statusLoading: "Loading…",
    statusError: "There was a problem",
    speed: "Speed",
    language: "日本語",
    undo: "Undo",
    try: "Try it",
    workbench: "Workbench",
    modeEdit: "Making",
    modePlaying: "Trying it",
    modePaused: "Paused to look",
    pause: "Pause",
    resume: "Continue",
    restart: "Start again",
    backEdit: "Edit",
    stageHint: "Choose a part below, then click where you want to put it in the picture.",
    selectionHint: "Grab it and move it",
    tiltLeft: "↶ Left",
    tiltRight: "↷ Right",
    duplicate: "Another one",
    remove: "Put away",
    parts: "Parts",
    partBall: "Ball",
    partRamp: "Ramp",
    partBlock: "Block",
    partDomino: "6 dominoes",
    partGoal: "Goal",
    partLauncher: "Drop balls",
    adultSettings: "Grown-up settings",
    technicalEditor: "Part details",
    placedHint: "Click where you want to put the part in the picture.",
    rampGuide: "Put the ramp on a block",
    rampPlaced: "The ramp is lined up on the block.",
    dominoArranged: "Placed six dominoes.",
    goalWaiting: "Get the ball to the goal.",
    goalReached: "You made it!",
    tryHint: "Let’s watch it move.",
    pausedHint: "Paused. Choose Edit to keep making.",
    backEditHint: "Change the place and try again.",
    selectedPartHint: "Grab to move. Use ↶↷ to turn it.",
    undone: "Went back one making step.",
    duplicated: "Placed another one.",
    removed: "Put the part away."
  }
};

// URLまたは保存済み設定から言語を選び、MakerとPlayerで同じ表示言語を使います
export function getLanguage() {
  const query = new URLSearchParams(globalThis.location?.search ?? "").get("lang");
  let stored;
  try { stored = globalThis.localStorage?.getItem("karakuri-language"); } catch { /* Browser storage may be disabled. */ }
  return query === "en" || query === "ja" ? query : stored === "en" || stored === "ja" ? stored : globalThis.navigator?.language?.startsWith("ja") ? "ja" : "en";
}

// 選択した言語を保存し、次に開くMakerとPlayerでも同じ言葉を表示します
export function setLanguage(language) {
  const value = language === "en" ? "en" : "ja";
  try { globalThis.localStorage?.setItem("karakuri-language", value); } catch { /* Keep this page usable without persistence. */ }
  return value;
}

// 現在の言語に対応する短い表示文字列を返し、HTMLに識別子を直接持ち込まないようにします
export function t(language, key) {
  return TEXT[language]?.[key] ?? TEXT.ja[key] ?? key;
}

// data-i18n属性を持つ画面要素へ一括で表示文を設定します
export function applyLanguage(root, language) {
  root.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(language, element.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-title]").forEach((element) => {
    element.title = t(language, element.dataset.i18nTitle);
  });
  document.documentElement.lang = language === "en" ? "en" : "ja";
  root.querySelectorAll('a[href]').forEach(link => {
    const url = new URL(link.getAttribute("href"), globalThis.location.href);
    if (url.origin !== globalThis.location.origin) return;
    url.searchParams.set("lang", language);
    link.href = url.href;
  });
}

// inputの値を安全に読み、Makerの小さな編集欄へ同じ数値変換を適用します
export function readNumber(input, fallback = 0) {
  const value = Number(input.value);
  if (!Number.isFinite(value)) return fallback;
  return value;
}

// status欄の文字列を変更したときだけ画面へ反映し、更新のちらつきを抑えます
export function setStatus(element, text, kind = "info") {
  if (!element) return;
  const next = String(text);
  if (element.textContent !== next) element.textContent = next;
  element.dataset.kind = kind;
}

// file inputから選択ファイルを一つ受け取り、MakerとPlayerの読込み経路を共通化します
export function chooseFile(input) {
  return new Promise((resolve) => {
    input.value = "";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

// 再生倍率をボタンへ表示するため、整数は小数一桁、それ以外は必要な桁数へ整えます
export function formatTimeScale(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "?";
  if (Math.abs(number - Math.round(number)) < 1e-9) return number.toFixed(1);
  return number.toFixed(2).replace(/0+$/, "");
}
