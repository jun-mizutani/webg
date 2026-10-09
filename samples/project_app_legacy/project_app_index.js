// ---------------------------------------------
//  project_app_index.js  2026/09/08
//   Dedicated entry point for the ProjectApp sample
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

// 過去fixtureを読むための保存用shimです。新しいコードはwebg/app/index.jsを使います。
export {
  default as ProjectApp,
  createWebgSceneApp as createProjectApp
} from "../../webg/app/WebgSceneApp.js";
