// ---------------------------------------------
//  Diagnostics.js 2026/04/04
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

import DebugConfig from "./DebugConfig.js";

export default class Diagnostics {

  static requireReport(report, methodName) {
    if (!report || typeof report !== "object" || Array.isArray(report)) {
      throw new Error(`Diagnostics.${methodName} requires a diagnostics report object`);
    }
    return report;
  }

  static requirePlainObject(value, methodName, name) {
    if (value === undefined) {
      return {};
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Diagnostics.${methodName} requires ${name} to be an object`);
    }
    return value;
  }

  static requireArray(value, methodName, name) {
    if (!Array.isArray(value)) {
      throw new Error(`Diagnostics.${methodName} requires ${name} to be an array`);
    }
    return value;
  }

  static requireInputFrame(frame, methodName, index = null) {
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
      const suffix = index === null ? "" : `[${index}]`;
      throw new Error(`Diagnostics.${methodName} requires input frame${suffix} to be an object`);
    }
    return frame;
  }

  // summary text は人と AI が最初に読む既定出口として使う
  // 低レベルな key=value dump は toText() に残しつつ、
  // まず何を見ればよいかが伝わる section 形式を別に持つ
  static toSummaryText(report, options = {}) {
    const safeReport = this.requireReport(report, "toSummaryText");
    const lines = [];
    const stats = this.requirePlainObject(safeReport.stats, "toSummaryText", "report.stats");
    const context = this.requirePlainObject(safeReport.context, "toSummaryText", "report.context");
    const statKeys = this.getSummaryStatKeys(stats);
    const contextKeys = Object.keys(context).sort();
    const maxDetails = Number.isInteger(options.maxDetails)
      ? Math.max(0, options.maxDetails)
      : 8;
    const maxWarnings = Number.isInteger(options.maxWarnings)
      ? Math.max(0, options.maxWarnings)
      : 4;
    const latestWarning = Array.isArray(safeReport.warnings) && safeReport.warnings.length > 0
      ? safeReport.warnings[safeReport.warnings.length - 1]
      : "";
    const latestIssue = safeReport.error || latestWarning || "(none)";

    lines.push("[Overview]");
    lines.push(`source=${safeReport.source ?? ""}`);
    lines.push(`system=${safeReport.system ?? "unknown"}`);
    lines.push(`stage=${safeReport.stage ?? "runtime"}`);
    lines.push(`ok=${safeReport.ok === true ? "true" : "false"}`);
    lines.push(`timestamp=${safeReport.timestamp ?? ""}`);
    lines.push("");

    lines.push("[Latest Issue]");
    lines.push(latestIssue);
    lines.push("");

    lines.push("[Key Stats]");
    if (statKeys.length <= 0) {
      lines.push("(none)");
    } else {
      for (let i = 0; i < statKeys.length; i++) {
        const key = statKeys[i];
        lines.push(`${key}=${safeReport.stats[key]}`);
      }
    }

    lines.push("");
    lines.push("[Warnings]");
    if (!Array.isArray(safeReport.warnings) || safeReport.warnings.length <= 0 || maxWarnings <= 0) {
      lines.push("(none)");
    } else {
      const warnings = safeReport.warnings.slice(-maxWarnings);
      for (let i = 0; i < warnings.length; i++) {
        lines.push(warnings[i]);
      }
    }

    lines.push("");
    lines.push("[Recent Details]");
    if (!Array.isArray(safeReport.details) || safeReport.details.length <= 0 || maxDetails <= 0) {
      lines.push("(none)");
    } else {
      const details = safeReport.details.slice(-maxDetails);
      for (let i = 0; i < details.length; i++) {
        lines.push(details[i]);
      }
    }

    if (options.includeContext === true) {
      lines.push("");
      lines.push("[Context]");
      if (contextKeys.length <= 0) {
        lines.push("(none)");
      } else {
        for (let i = 0; i < contextKeys.length; i++) {
          const key = contextKeys[i];
          lines.push(`${key}=${context[key]}`);
        }
      }
    }

    return lines.join("\n");
  }

  // summary で最初に見たい統計値を先に並べ、
  // dock / copy / panel のどこで読んでも重要な値を追いやすくする
  static getSummaryStatKeys(stats = {}) {
    const normalizedStats = this.requirePlainObject(stats, "getSummaryStatKeys", "stats");
    const keys = Object.keys(normalizedStats);
    const preferred = [
      "eyeX",
      "eyeY",
      "eyeZ",
      "eyeYaw",
      "eyePitch",
      "eyeBank",
      "cameraTargetX",
      "cameraTargetY",
      "cameraTargetZ",
      "eyeDistance",
      "fovX",
      "fovY",
      "appShaderClass",
      "vertexCount",
      "triangleCount",
      "boneCount",
      "nodeCount",
      "shapeCount",
      "meshCount",
      "visibleShapeCount",
      "hiddenShapeCount",
      "skinnedShapeCount",
      "primitiveCount",
      "modelCount",
      "entryCount",
      "clipCount",
      "runtimeAnimations",
      "animationCount",
      "canvasWidth",
      "canvasHeight",
      "displayWidth",
      "displayHeight",
      "frameCount",
      "sceneWarnings",
      "envOk",
      "uptimeSec"
    ];
    const preferredSet = new Set(preferred);
    const ordered = [];
    for (let i = 0; i < preferred.length; i++) {
      const key = preferred[i];
      if (Object.prototype.hasOwnProperty.call(normalizedStats, key)) {
        ordered.push(key);
      }
    }
    const rest = keys
      .filter((key) => !preferredSet.has(key))
      .sort();
    return [...ordered, ...rest];
  }

  // 旧 loader 指定も受けつつ、内部では system 主軸へ正規化する
  static resolveSystem(init = {}) {
    const system = init.system ?? init.loader ?? "unknown";
    return String(system);
  }

  // 共通 report object を生成する
  static createReport(init = {}) {
    if (!init || typeof init !== "object" || Array.isArray(init)) {
      throw new Error("Diagnostics.createReport requires an init object");
    }
    const system = this.resolveSystem(init);
    return {
      system,
      source: init.source ?? "",
      stage: init.stage ?? "runtime",
      ok: init.ok ?? true,
      error: init.error ?? "",
      details: Array.isArray(init.details) ? [...init.details] : [],
      warnings: Array.isArray(init.warnings) ? [...init.warnings] : [],
      stats: { ...(init.stats ?? {}) },
      context: { ...(init.context ?? {}) },
      timestamp: init.timestamp ?? new Date().toISOString()
    };
  }

  // 成功 report を生成する
  static createSuccessReport(init = {}) {
    return this.createReport({ ...init, ok: true, error: init.error ?? "" });
  }

  // 例外や文字列から失敗 report を生成する
  static createErrorReport(error, init = {}) {
    if (error === undefined || error === null) {
      throw new Error("Diagnostics.createErrorReport requires an error value");
    }
    const err = error instanceof Error ? error : new Error(String(error));
    const report = this.createReport({
      ...init,
      ok: false,
      error: err.message ?? String(err)
    });
    if (err.stack) {
      report.context.stack = err.stack;
    }
    return report;
  }

  // 保存済み progress を diagnostics report として表現する
  // sample 側が localStorage の raw JSON を直接扱わなくても、
  // report として保存内容の要点と payload を同じ形で確認できるようにする
  static createProgressReport(data, init = {}) {
    const payload = data === undefined ? null : data;
    const payloadType = Array.isArray(payload)
      ? "array"
      : payload === null
        ? "null"
        : typeof payload;
    const details = Array.isArray(init.details) ? [...init.details] : [];
    const context = {
      ...(init.context ?? {}),
      key: init.key ?? "",
      storageKey: init.storageKey ?? "",
      label: init.label ?? "",
      data: payload
    };
    const stats = {
      ...(init.stats ?? {}),
      schemaVersion: init.version === undefined
        ? 1
        : Number.isFinite(init.version)
          ? Number(init.version)
          : (() => { throw new Error("Diagnostics.createProgressReport requires finite init.version"); })(),
      dataType: payloadType
    };

    details.push(`key=${String(context.key ?? "")}`);
    details.push(`storageKey=${String(context.storageKey ?? "")}`);
    details.push(`dataType=${payloadType}`);

    return this.createSuccessReport({
      ...init,
      stage: init.stage ?? "progress",
      details,
      context,
      stats
    });
  }

  // 入力 replay 用 report を生成する
  // 長い入力列そのものは context に残しつつ、details には最初に見るべき要点だけを置く
  static createReplayReport(inputLog, init = {}) {
    const log = this.requireArray(inputLog, "createReplayReport", "inputLog");
    const uniqueKeys = new Set();
    const uniqueActions = new Set();
    for (let i = 0; i < log.length; i++) {
      const frame = this.requireInputFrame(log[i], "createReplayReport", i);
      const keys = frame.keys === undefined
        ? []
        : this.requireArray(frame.keys, "createReplayReport", `inputLog[${i}].keys`);
      for (let j = 0; j < keys.length; j++) {
        uniqueKeys.add(String(keys[j]));
      }
      const actions = frame.actions === undefined
        ? {}
        : this.requirePlainObject(frame.actions, "createReplayReport", `inputLog[${i}].actions`);
      for (const actionName of Object.keys(actions)) {
        uniqueActions.add(String(actionName));
      }
    }

    const details = Array.isArray(init.details) ? [...init.details] : [];
    details.push(`frames=${log.length}`);
    details.push(`uniqueKeys=${uniqueKeys.size}`);
    details.push(`uniqueActions=${uniqueActions.size}`);
    if (log.length > 0) {
      details.push(`first=${this.summarizeInputFrame(log[0], 0)}`);
      details.push(`last=${this.summarizeInputFrame(log[log.length - 1], log.length - 1)}`);
    }

    return this.createSuccessReport({
      ...init,
      stage: init.stage ?? "replay",
      details,
      context: {
        ...(init.context ?? {}),
        inputLog: log
      },
      stats: {
        ...(init.stats ?? {}),
        frameCount: log.length,
        uniqueKeyCount: uniqueKeys.size,
        uniqueActionCount: uniqueActions.size
      }
    });
  }

  // 入力 timeline を 1 frame ずつ追える report を生成する
  // debug 時に「どの frame で何が押されていたか」を text と JSON の両方で確認しやすくする
  static createInputTimelineReport(inputLog, init = {}) {
    const log = this.requireArray(inputLog, "createInputTimelineReport", "inputLog");
    const details = Array.isArray(init.details) ? [...init.details] : [];
    for (let i = 0; i < log.length; i++) {
      details.push(this.summarizeInputFrame(log[i], i));
    }

    return this.createSuccessReport({
      ...init,
      stage: init.stage ?? "input-timeline",
      details,
      context: {
        ...(init.context ?? {}),
        inputLog: log
      },
      stats: {
        ...(init.stats ?? {}),
        frameCount: log.length
      }
    });
  }

  // InputController で記録した frame を、読みやすい 1 行へ要約する
  static summarizeInputFrame(frame, index = 0) {
    const safeFrame = this.requireInputFrame(frame, "summarizeInputFrame", index);
    const keys = safeFrame.keys === undefined
      ? []
      : this.requireArray(safeFrame.keys, "summarizeInputFrame", `frame[${index}].keys`);
    const actions = safeFrame.actions === undefined
      ? {}
      : this.requirePlainObject(safeFrame.actions, "summarizeInputFrame", `frame[${index}].actions`);
    const active = [];
    const pressed = [];
    const released = [];
    for (const actionName of Object.keys(actions)) {
      const info = this.requirePlainObject(actions[actionName], "summarizeInputFrame", `frame[${index}].actions.${actionName}`);
      if (info.active === true) active.push(actionName);
      if (info.pressed === true) pressed.push(actionName);
      if (info.released === true) released.push(actionName);
    }
    const frameNo = safeFrame.frame === undefined
      ? "n/a"
      : Number.isFinite(safeFrame.frame)
        ? Number(safeFrame.frame)
        : (() => { throw new Error(`Diagnostics.summarizeInputFrame requires frame[${index}].frame to be finite when present`); })();
    const keyText = keys.length > 0 ? keys.map((key) => String(key)).join(",") : "-";
    const activeText = active.length > 0 ? active.join(",") : "-";
    const pressedText = pressed.length > 0 ? pressed.join(",") : "-";
    const releasedText = released.length > 0 ? released.join(",") : "-";
    return `#${index} frame=${frameNo} keys=${keyText} active=${activeText} pressed=${pressedText} released=${releasedText}`;
  }

  // 詳細行を追加する
  static addDetail(report, line) {
    report.details.push(String(line));
    return report;
  }

  // 警告行を追加する
  static addWarning(report, line) {
    report.warnings.push(String(line));
    return report;
  }

  // 統計値を 1 つ設定する
  static setStat(report, key, value) {
    report.stats[key] = value;
    return report;
  }

  // 複数統計値をまとめて設定する
  static mergeStats(report, stats = {}) {
    Object.assign(report.stats, stats);
    return report;
  }

  // report を key=value 形式の text へ変換する
  static toText(report, options = {}) {
    const safeReport = this.requireReport(report, "toText");
    const lines = [];
    const source = safeReport.source ?? "";
    lines.push(`system=${safeReport.system ?? "unknown"}`);
    lines.push(`source=${source}`);
    lines.push(`stage=${safeReport.stage ?? "runtime"}`);
    lines.push(`ok=${safeReport.ok === true ? "true" : "false"}`);
    if (safeReport.error) {
      lines.push(`error=${safeReport.error}`);
    }
    for (let i = 0; i < (safeReport.details?.length ?? 0); i++) {
      lines.push(`detail=${safeReport.details[i]}`);
    }
    for (let i = 0; i < (safeReport.warnings?.length ?? 0); i++) {
      lines.push(`warning=${safeReport.warnings[i]}`);
    }
    const statKeys = Object.keys(this.requirePlainObject(safeReport.stats, "toText", "report.stats")).sort();
    for (let i = 0; i < statKeys.length; i++) {
      const key = statKeys[i];
      lines.push(`stat.${key}=${safeReport.stats[key]}`);
    }
    if (options.includeContext === true) {
      const context = this.requirePlainObject(safeReport.context, "toText", "report.context");
      const contextKeys = Object.keys(context).sort();
      for (let i = 0; i < contextKeys.length; i++) {
        const key = contextKeys[i];
        lines.push(`context.${key}=${context[key]}`);
      }
    }
    lines.push(`timestamp=${safeReport.timestamp ?? ""}`);
    return lines.join("\n");
  }

  // report を整形済み JSON へ変換する
  static toJSON(report, space = 2) {
    return JSON.stringify(report, null, space);
  }

  // clipboard へ text をコピーする
  static async copyText(report, options = {}) {
    const text = this.toText(report, options);
    return await this.copyString(text);
  }

  // summary text を clipboard へコピーする
  static async copySummary(report, options = {}) {
    return await this.copyString(this.toSummaryText(report, options));
  }

  // clipboard へ JSON をコピーする
  static async copyJSON(report, space = 2) {
    return await this.copyString(this.toJSON(report, space));
  }

  // 文字列コピー本体
  static async copyString(text) {
    if (!DebugConfig.isEnabled("enableDiagnostics")) {
      return false;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    if (typeof document === "undefined" || !document.createElement || !document.body) {
      return false;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "readonly");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, area.value.length);
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (err) {
      copied = false;
    }
    document.body.removeChild(area);
    return copied;
  }

  // text report を保存する
  static downloadText(report, filename = "diagnostics.txt", options = {}) {
    return this.downloadString(this.toText(report, options), filename, "text/plain");
  }

  // JSON report を保存する
  static downloadJSON(report, filename = "diagnostics.json", space = 2) {
    return this.downloadString(this.toJSON(report, space), filename, "application/json");
  }

  // 文字列保存本体
  static downloadString(text, filename, mimeType) {
    if (!DebugConfig.isEnabled("enableDiagnostics")) {
      return text;
    }
    if (typeof document === "undefined" || !document.createElement || !document.body) {
      return text;
    }
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return text;
  }
}
