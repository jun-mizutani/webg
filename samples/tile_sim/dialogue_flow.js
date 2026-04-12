// -------------------------------------------------
// tile_sim sample
//   dialogue_flow.js 2026/04/01
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// -------------------------------------------------

// この module は、tile_sim で DialogueOverlay をどう使うかをまとめる
// - title の導入説明、play 開始時の briefing、turn 中の短い event、result の締めを同じ進行モデルへそろえる
// - tile_sim は DialogueOverlay の有効性確認も目的に含むため、必要な情報を会話 overlay 側へ寄せる

// tile_sim 用 overlay theme
// - tutorial と戦況報告を読みやすくするため、本文、STATE、補助文を白系へ寄せる
// - 背景は読みやすさを保ちつつ少し軽くし、中央の scene を隠しすぎないようにする
const TILE_SIM_DIALOGUE_THEME = {
  panelBackground: "rgba(6, 12, 24, 0.66)",
  panelBorder: "rgba(210, 226, 255, 0.34)",
  panelShadow: "0 18px 34px rgba(0, 0, 0, 0.34)",
  textBlockBackground: "rgba(255, 255, 255, 0.05)",
  textMain: "#ffffff",
  textSub: "#ffffff",
  accentText: "#ffffff",
  accentBackground: "rgba(170, 196, 255, 0.16)",
  buttonBackground: "rgba(66, 92, 150, 0.34)",
  buttonHoverBackground: "rgba(84, 116, 186, 0.48)",
  buttonBorder: "rgba(228, 238, 255, 0.42)",
  buttonHoverBorder: "rgba(255, 255, 255, 0.68)",
  buttonText: "#ffffff",
  hintText: "#ffffff",
  eyebrowFont: `700 10px/1.15 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif`,
  titleFont: `700 20px/1.28 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif`,
  titleCompactFont: `700 18px/1.28 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif`,
  headingFont: `700 12px/1.4 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif`,
  copyFont: `400 14px/1.72 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif`,
  hintFont: `600 11px/1.6 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif`,
  buttonFont: `700 13px/1.4 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif`,
  pillFont: `700 12px/1.25 "Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif`,
  textBlockFont: `700 12px/1.62 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
  statusFont: `700 12px/1.58 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
  backdropBlur: "3px",
  statusBackdropBlur: "2px"
};

// title で最初に見せる導入文を作る
// - まだ game を始める前に、TileMap と strategy simulation の関係、overlay の読み方、最初の目標を順に共有する
const buildTitleIntroEntries = (mission) => {
  return [
    {
      speaker: "司令部",
      side: "left",
      title: "tile_sim とは",
      lines: [
        "tile_sim は TileMap の高さ差に、複数部隊と資源差を重ねて試す sample です。",
        "この段階では、主要な情報を DialogueOverlay だけで確認できる構成を試します。"
      ]
    },
    {
      speaker: "司令部",
      side: "left",
      title: "DialogueOverlay の見方",
      lines: [
        "左の大きい欄は、司令部や各報告役が読む本文です。",
        "右の STATE 欄は、今の発話者、見出し、選択肢数、直近の選択、進行状態をまとめる確認欄です。"
      ]
    },
    {
      speaker: "司令部",
      side: "left",
      title: "最初の目標",
      lines: [
        `今回の mission では beacon を ${mission?.beacons?.length ?? 0} 個回収してから goal へ入ります。`,
        "Enter / Space で会話を進めたあと、会話が閉じた状態でもう一度 Enter / Space か GO を押すと mission を始めます。"
      ]
    }
  ];
};

// play 開始直後に見せる briefing を作る
// - どの unit が何をするか、何を操作すればよいか、overlay と盤面の関係を順に読めるようにする
const buildPlayBriefingEntries = (mission) => {
  return [
    {
      speaker: "司令部",
      side: "left",
      title: "操作の中心",
      lines: [
        "あなたが直接動かすのは Alpha だけです。",
        "会話が閉じたら Arrow または touch button で Alpha を 1 手ずつ動かし、beacon を全部回収してから goal へ入ります。"
      ]
    },
    {
      speaker: "司令部",
      side: "left",
      title: "部隊の見分け方",
      lines: [
        "Alpha は薄い赤寄りの human.glb を使った前衛です。",
        "Bravo は水色寄り、Mule は緑寄り、Warden は赤寄りに色を変えた human.glb として盤面上に出ます。"
      ]
    },
    {
      speaker: "司令部",
      side: "left",
      title: "各部隊の役割",
      lines: [
        "Bravo は Alpha のあとに自動で動き、高い地形へ寄って見張りと射撃位置の確保を担当します。",
        "Mule は低い地形へ寄って food と arms を集め、補給が細る前に後方の安定役として動きます。",
        "Warden は敵監視部隊で、高地や goal 周辺へ寄って Alpha の進路へ圧力を掛けます。"
      ]
    },
    {
      speaker: "司令部",
      side: "left",
      title: "進行の流れ",
      lines: [
        "Alpha を 1 手動かすたびに、Bravo、Mule、Warden が順に反応し、重要な変化があった turn では report が追加されます。",
        "report が開いている間は移動を受け付けないので、内容を読んで閉じてから次の 1 手を考えます。"
      ]
    },
    {
      speaker: "司令部",
      side: "left",
      title: "方針選択",
      lines: [
        `最短目安は ${mission?.minimumMoves ?? 0} 手、budget は ${mission?.movesLimit ?? 0} 手です。`,
        "budget は作戦上の目安で、超えても mission 自体は継続します。",
        "どちらの見方で最初の briefing を受けるか選んでください。"
      ],
      choices: [
        {
          label: "高地重視",
          next: [
            {
              speaker: "司令部",
              side: "left",
              title: "高地重視",
              lines: [
                "Bravo が高地へ上がりやすい経路を優先して見る考え方です。",
                "高地は強い反面、food 消費が重いので、右側 STATE 欄や短い flash を見ながら補給の減りも確認してください。"
              ]
            }
          ]
        },
        {
          label: "低地補給重視",
          next: [
            {
              speaker: "司令部",
              side: "left",
              title: "低地補給重視",
              lines: [
                "Mule が低地で food / arms を貯めやすい流れを優先して見る考え方です。",
                "低地は戦闘面では弱い代わりに、補給の回復と持久戦の感触を確認しやすくします。"
              ]
            }
          ]
        }
      ]
    },
    {
      speaker: "司令部",
      side: "left",
      title: "操作まとめ",
      lines: [
        "会話中は Enter / Space で次へ、1 / 2 で選択肢を選びます。",
        "盤面を click / tap すると、その cell の高さ、terrain、beacon / goal の有無を DialogueOverlay で調べられます。",
        "camera は 1本指 drag で回転し、2本指 drag で移動、pinch で zoom できます。"
      ]
    }
  ];
};

// result 画面用の短い締めを作る
// - 現在は clear が主経路だが、result 表示自体は generic に保ち、briefing と同じ表現系で最後まで追えるようにする
const buildResultEntries = (mission) => {
  if ((mission?.resultKind ?? "") === "clear") {
    return [
      {
        speaker: "司令部",
        side: "left",
        title: "Mission Clear",
        lines: [
          mission?.resultMessage ?? "MISSION CLEAR",
          "goal 確保までの流れを DialogueOverlay の briefing / report / debrief で確認できました。"
        ]
      }
    ];
  }
  return [
    {
      speaker: "司令部",
      side: "left",
      title: "Mission Failed",
      lines: [
        mission?.resultMessage ?? "MISSION FAILED",
        "補給と敵接近の流れを見直して再挑戦してください。"
      ]
    }
  ];
};

// 直近 turn で起きた重要 event を短い overlay entry へ変換する
// - 長い会話ではなく、objective 進行や敵接近のような変化だけを短文で重ねる方が tile_sim には自然
const buildTurnEventEntries = (mission, alphaUnit, changes = {}) => {
  const entries = [];
  const collectedDelta = Math.max(0, (mission?.collectedCount ?? 0) - (changes.prevCollectedCount ?? 0));
  if (collectedDelta > 0) {
    entries.push({
      speaker: "偵察報告",
      side: "right",
      title: "Beacon Secured",
      lines: [
        `beacon 回収数が ${mission.collectedCount}/${mission.beacons.length} へ進みました。`,
        "盤面の marker 変化と overlay の説明が対応しているかを確認できます。"
      ]
    });
  }
  if (changes.prevGoalUnlocked === false && mission?.goalUnlocked) {
    entries.push({
      speaker: "司令部",
      side: "left",
      title: "Goal Open",
      lines: [
        "すべての beacon を回収したため goal が開きました。",
        "以後は Warden の守備位置、Alpha の進路、Bravo の高地確保を見比べてください。"
      ]
    });
  }
  if ((mission?.turnSummary ?? "").includes("CONTACT WARDEN")) {
    entries.push({
      speaker: "前線報告",
      side: "right",
      title: "Enemy Contact",
      lines: [
        mission.turnSummary,
        `${alphaUnit?.label ?? "ALPHA"} と Warden が近接距離へ入りました。`,
        "次の 1 手で押し込むか、Bravo の位置を待ちながら下がるかを比較しやすい場面です。"
      ]
    });
  } else if ((mission?.turnSummary ?? "").includes("THREAT RANGE")) {
    entries.push({
      speaker: "前線報告",
      side: "right",
      title: "Threat Range",
      lines: [
        mission.turnSummary,
        "次の 1 手で高地へ寄るか、低地へ逃がすかを比較しやすい場面です。"
      ]
    });
  }
  return entries;
};

// click で選んだ cell の情報を overlay へ出す
// - HUD を使わない段階では、inspection 情報も DialogueOverlay 側へ寄せる
const buildCellInspectEntries = (hit, mission, aiSnapshot = null) => {
  const cell = hit?.cell ?? null;
  if (!cell) {
    return [];
  }
  const beaconHere = Array.isArray(mission?.beacons)
    ? mission.beacons.find((beacon) => beacon.cell?.col === cell.col && beacon.cell?.row === cell.row && !beacon.collected)
    : null;
  const isGoal = mission?.goalCell?.col === cell.col && mission?.goalCell?.row === cell.row;
  return [
    {
      speaker: "地形報告",
      side: "right",
      title: `Cell (${cell.col},${cell.row})`,
      lines: [
        `Terrain ${String(cell.terrain ?? "-").toUpperCase()}   Height ${cell.height ?? 0}`,
        `TopY ${Number.isFinite(cell.topY) ? cell.topY.toFixed(2) : "-"}`,
        beaconHere ? "この cell には未回収 beacon があります。" : isGoal ? `この cell は goal です ${mission?.goalUnlocked ? "OPEN" : "LOCKED"}` : "この cell には beacon / goal はありません。"
      ]
    },
    {
      speaker: "AI 観測",
      side: "right",
      title: "Context",
      lines: [
        aiSnapshot?.policyLabel ? `Current policy ${aiSnapshot.policyLabel}` : "Current policy -",
        hit?.hitFace ? `Selected face ${String(hit.hitFace).toUpperCase()}` : "Selected face -",
        "tile inspection も DialogueOverlay で読めるようにしています。"
      ]
    }
  ];
};

// tile_sim 用の DialogueOverlay 制御をまとめる
export const createTileSimDialogueDirector = (app, providers = {}) => {
  const buildStateLines = () => {
    const mission = typeof providers.getMission === "function" ? providers.getMission() : null;
    const alphaUnit = typeof providers.getAlphaUnit === "function" ? providers.getAlphaUnit() : null;
    const phase = typeof providers.getScenePhase === "function" ? providers.getScenePhase() : (app.getScenePhase?.() ?? "title");
    const leftMoves = Math.max(0, (mission?.movesLimit ?? 0) - (mission?.movesUsed ?? 0));
    return [
      `PHASE ${String(phase ?? "title").toUpperCase()}`,
      `BEACON ${mission?.collectedCount ?? 0}/${mission?.beacons?.length ?? 0}`,
      `GOAL ${mission?.goalUnlocked ? "OPEN" : "LOCKED"}`,
      `MOVES ${mission?.movesUsed ?? 0}/${mission?.movesLimit ?? 0}`,
      `LEFT ${leftMoves}`,
      alphaUnit
        ? `ALPHA (${alphaUnit.cell?.col ?? "-"},${alphaUnit.cell?.row ?? "-"}) F${alphaUnit.food ?? 0} A${alphaUnit.arms ?? 0}`
        : "ALPHA -"
    ];
  };

  const overlayOptions = {
    title: "tile_sim 会話",
    footer: "Enter / Space / Arrow: 次へ  1 / 2: 選択",
    stateTitle: "STATE",
    choicePromptText: "1 / 2 で分岐を選択",
    advancePromptText: "Enter / Space / Arrow で次へ進む",
    visibleHintText: "左は会話ログ、右は現在の会話状態",
    hiddenHintText: "DialogueOverlay は閉じています",
    showNextButton: false,
    showRestartButton: false,
    showHideButton: false,
    appendHistory: true,
    flipMainPanelBySide: false,
    getStateLines: buildStateLines,
    // viewport 幅基準の vw を使うと、debug dock 表示で canvas が狭くなっても
    // 右側 STATE panel だけが太いまま残りやすい
    // tile_sim では固定上限つきの幅へ寄せ、dock 表示時も 2 カラムが収まりやすい形にする
    leftWidth: "minmax(200px, 360px)",
    rightWidth: "minmax(180px, 240px)",
    gap: 10,
    spreadColumns: true,
    collapseWidth: 820,
    compactWidth: 700,
    top: 12,
    left: 12,
    theme: TILE_SIM_DIALOGUE_THEME
  };
  const observation = {
    collectedCount: 0,
    goalUnlocked: false
  };

  // current mission を次の比較基準として保存する
  const syncObservation = (mission) => {
    observation.collectedCount = mission?.collectedCount ?? 0;
    observation.goalUnlocked = mission?.goalUnlocked === true;
  };

  // title 用の導入説明を最初から表示する
  const startTitleIntro = (mission) => {
    syncObservation(mission);
    return app.startDialogue(buildTitleIntroEntries(mission), {
      ...overlayOptions,
      title: "tile_sim 導入",
      footer: "Enter / Space / Arrow: 次へ  GO / Enter: mission 開始"
    });
  };

  // play 開始時の briefing を表示する
  const startPlayBriefing = (mission) => {
    syncObservation(mission);
    return app.startDialogue(buildPlayBriefingEntries(mission), {
      ...overlayOptions,
      title: "tile_sim 作戦説明",
      footer: "Enter / Space / Arrow: 次へ  1 / 2: 選択"
    });
  };

  // result の短い締めを表示する
  const startResultDebrief = (mission) => {
    syncObservation(mission);
    return app.startDialogue(buildResultEntries(mission), {
      ...overlayOptions,
      title: "tile_sim 結果報告",
      footer: "Enter / Space / Arrow: 次へ  GO / Enter: retry"
    });
  };

  // turn 中の warning / event だけを overlay へ流す
  // - 常時の状態一覧は右側 STATE 欄で追い、左側の本文は重要な変化だけへ絞る
  const startTurnReport = ({
    mission,
    alphaUnit = null
  } = {}) => {
    const eventEntries = buildTurnEventEntries(mission, alphaUnit, {
      prevCollectedCount: observation.collectedCount,
      prevGoalUnlocked: observation.goalUnlocked
    });
    const entries = [...eventEntries];
    syncObservation(mission);
    if (entries.length <= 0) {
      return 0;
    }
    app.logDialogue(entries, {
      ...overlayOptions,
      title: "tile_sim 戦況報告",
      footer: "Arrow で移動しながら会話ログを読み進められます"
    });
    return entries.length;
  };

  // click で選んだ cell の inspection overlay を表示する
  const startCellInspect = (hit, mission, aiSnapshot = null) => {
    const entries = buildCellInspectEntries(hit, mission, aiSnapshot);
    if (entries.length <= 0) {
      return 0;
    }
    app.logDialogue(entries, {
      ...overlayOptions,
      title: "tile_sim 地形調査",
      footer: "click した cell の情報を会話ログへ追記します"
    });
    return entries.length;
  };

  return {
    startTitleIntro,
    startPlayBriefing,
    startResultDebrief,
    startTurnReport,
    startCellInspect
  };
};
