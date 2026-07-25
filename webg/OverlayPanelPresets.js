// ---------------------------------------------
// OverlayPanelPresets.js 2026/04/30
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import { DEFAULT_UI_THEME } from "./WebgUiTheme.js";
import util from "./util.js";

// OverlayPanel preset helpers:
// - core class を増やさず、help / error の代表的な option だけを組み立てる
// - WebgApp には置かず、必要な sample / book example が明示 import して使う

export function buildHelpPanelOptions(options = {}) {
  const safeOptions = util.readPlainObject(options, "buildHelpPanelOptions options");
  const lines = Array.isArray(safeOptions.lines) ? safeOptions.lines.map((line) => String(line)) : [];
  return {
    id: safeOptions.id ?? "help",
    title: safeOptions.title ?? "Help",
    lines,
    anchor: safeOptions.anchor ?? "top-left",
    offsetX: util.readOptionalFiniteNumber(safeOptions.offsetX, "buildHelpPanelOptions offsetX", 16),
    offsetY: util.readOptionalFiniteNumber(safeOptions.offsetY, "buildHelpPanelOptions offsetY", 16),
    width: safeOptions.width,
    minWidth: safeOptions.minWidth,
    maxWidth: safeOptions.maxWidth ?? "340px",
    maxHeight: safeOptions.maxHeight ?? "40vh",
    format: safeOptions.format ?? (safeOptions.code === true ? "pre" : "plain"),
    scrollY: safeOptions.scrollY === true,
    closable: safeOptions.closable === true,
    collapsible: safeOptions.collapsible !== false,
    collapsed: safeOptions.collapsed === true || safeOptions.visible === false,
    showCloseButton: safeOptions.showCloseButton === true,
    showCollapseButton: safeOptions.showCollapseButton !== false,
    collapseLabelExpanded: safeOptions.collapseLabelExpanded ?? safeOptions.hideLabel ?? "Hide Help",
    collapseLabelCollapsed: safeOptions.collapseLabelCollapsed ?? safeOptions.showLabel ?? "Show Help",
    avoidDebugDock: safeOptions.avoidDebugDock !== false
  };
}

export function buildErrorPanelOptions(error, options = {}) {
  const safeOptions = util.readPlainObject(options, "buildErrorPanelOptions options");
  const fixedTheme = {
    ...DEFAULT_UI_THEME.fixedFormatPanel,
    ...util.readPlainObject(safeOptions.theme, "buildErrorPanelOptions theme", {})
  };
  return {
    id: safeOptions.id ?? "error",
    title: safeOptions.title ?? "Error",
    text: error?.message ?? String(error ?? ""),
    anchor: safeOptions.anchor ?? "bottom-right",
    offsetX: util.readOptionalFiniteNumber(safeOptions.offsetX, "buildErrorPanelOptions offsetX", 16),
    offsetY: util.readOptionalFiniteNumber(safeOptions.offsetY, "buildErrorPanelOptions offsetY", 16),
    format: "pre",
    scrollY: true,
    closable: true,
    modal: safeOptions.modal === true,
    pauseScene: safeOptions.pauseScene === true || safeOptions.modal === true,
    showCloseButton: true,
    maxHeight: safeOptions.maxHeight ?? "40vh",
    color: safeOptions.color ?? fixedTheme.errorText,
    background: safeOptions.background ?? fixedTheme.errorBackground,
    avoidDebugDock: safeOptions.avoidDebugDock !== false
  };
}
