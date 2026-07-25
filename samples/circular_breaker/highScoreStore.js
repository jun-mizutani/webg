// ---------------------------------------------
// samples/circular_breaker/highScoreStore.js  2026/07/25
//   circular_breaker sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------
const HIGH_SCORE_KEY = "circular_breaker.highscores.v1";

// この file は gameRuntime.js から createHighScoreStore() として呼ばれ、
// saveProgress / loadProgress と localStorage fallback の差を吸収する
// runtime 側は top5 を読む / 追加する用途だけに集中し、
// 保存媒体の違いはここで閉じ込める

// 保存データは progress helper と localStorage のどちらから読んでも
// 同じ整形結果になるようここで正規化する
const normalizeScoreList = (list) => {
  if (!Array.isArray(list)) return [];
  return list
    .map((value) => ({
      score: Number(value?.score) || 0,
      at: Number(value?.at) || 0
    }))
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, 5);
};

// circular_breaker 用の high score 保存 helper
// runtime 側は「score を追加する」「現在の top5 を読む」だけに集中し、
// 保存媒体の違いはこの module に閉じ込める
export const createHighScoreStore = ({
  loadProgress,
  saveProgress
} = {}) => {
  // `high`の`scores`を読み込み、検証済みのデータとして後続処理へ渡す
  const loadHighScores = () => {
    try {
      if (typeof loadProgress === "function") {
        return normalizeScoreList(loadProgress(HIGH_SCORE_KEY, []));
      }
      if (typeof window === "undefined" || !window.localStorage) return [];
      const raw = window.localStorage.getItem(HIGH_SCORE_KEY);
      if (!raw) return [];
      return normalizeScoreList(JSON.parse(raw));
    } catch (_) {
      return [];
    }
  };

  // `high`の`scores`を指定された形式または保存先へ出力する
  const saveHighScores = (list) => {
    const top5 = normalizeScoreList(list);
    try {
      if (typeof saveProgress === "function") {
        saveProgress(HIGH_SCORE_KEY, top5);
        return top5;
      }
      if (typeof window === "undefined" || !window.localStorage) return top5;
      window.localStorage.setItem(HIGH_SCORE_KEY, JSON.stringify(top5));
      return top5;
    } catch (_) {
      return top5;
    }
  };

  // `high`の`score`を対象へ追加し、後続処理から参照できるようにする
  const addHighScore = (score) => {
    const list = loadHighScores();
    list.push({
      score: Number(score) || 0,
      at: Date.now()
    });
    return saveHighScores(list);
  };

  return {
    loadHighScores,
    saveHighScores,
    addHighScore
  };
};

export default createHighScoreStore;
