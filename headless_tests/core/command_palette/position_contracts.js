import assert from "node:assert/strict";
import CommandPalette, {
  getDefaultCommandPaletteCss
} from "../../../webg/CommandPalette.js";

// DOM全体を用意せず位置計算だけを検証するため、実instanceと同じprototypeへ
// viewport、container、rootの最小限の矩形interfaceを設定する
const palette = Object.create(CommandPalette.prototype);
const viewportRect = {
  left: 100,
  top: 50,
  width: 320,
  height: 400
};
const rootStyle = {};
palette.viewport = {
  getBoundingClientRect: () => viewportRect
};
palette.container = {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 })
};
palette.root = {
  style: rootStyle,
  getBoundingClientRect: () => ({
    left: 0,
    top: 0,
    width: Math.min(264, Number.parseFloat(rootStyle.maxWidth) || 264),
    // 10行以上を想定した自然高520pxが、viewport用maxHeightで制限される状態を再現する
    height: Math.min(520, Number.parseFloat(rootStyle.maxHeight) || 520)
  })
};
palette._hasCustomPosition = false;
palette._centerClientX = null;
palette._centerClientY = null;

// 320x400のviewportでは上下左右8pxを残し、Paletteのscroll領域を304x384以下へ制限する
palette.applyViewportSizeLimits(viewportRect);
assert.equal(rootStyle.maxWidth, "304px");
assert.equal(rootStyle.maxHeight, "384px");

// 上端付近のdouble tapでも、制限後の実寸384pxを使って中心を再配置する
// viewportの上端50、下端450に対してrootは58から442へ収まり、titleが上へ切れない
palette.place(110, 60);
assert.equal(rootStyle.left, "244px");
assert.equal(rootStyle.top, "250px");

// default CSSにも縦scrollとsticky titleが含まれ、viewportより内容が高い場合の操作を維持する
const css = getDefaultCommandPaletteCss();
assert.match(css, /max-height:\s*calc\(100vh - 16px\)/);
assert.match(css, /overflow-y:\s*auto/);
assert.match(css, /\.command-palette-title\s*\{[\s\S]*position:\s*sticky/);

console.log("PASS command_palette_position_contracts");
