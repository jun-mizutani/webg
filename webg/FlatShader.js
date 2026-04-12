// ---------------------------------------------
// FlatShader.js 2026/04/10
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

'use strict';

import SmoothShader from "./SmoothShader.js";

export default class FlatShader extends SmoothShader {

  // smooth 系と同じ bind group / material API を保ったまま、
  // 最終法線だけを「補間頂点法線」ではなく「現在 fragment の面法線」へ置き換える
  // これにより texture / normal map / fog / skinning の入口を共通化しつつ、
  // 見え方だけを flat shading 用に切り替えられる
  constructor(gpu, options = {}) {
    super(gpu, options);

    this.wgslSrc = this.wgslSrc.replace(
      "var nnormal = normalize(input.vNormal);",
      `let facing = select(-1.0, 1.0, input.frontFacing);
        var nnormal = normalize(cross(dpdy(input.vPosition), dpdx(input.vPosition))) * facing;`
    );
  }
}
