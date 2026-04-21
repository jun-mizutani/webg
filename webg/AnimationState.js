// ---------------------------------------------
//  AnimationState.js        2026/04/21
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

export default class AnimationState {

  // Action や runtime animation helper を受け取り、
  // 状態名と遷移条件から再生対象を切り替える最小 state machine
  constructor(controller, options = {}) {
    this.controller = controller;
    this.initialState = options.initialState ?? null;
    this.states = new Map();
    this.variables = {};
    this.currentStateId = null;
    this.currentState = null;
    this.currentTransition = null;
    this.lastTransition = null;
    this.started = false;
    this.playing = false;
    this.paused = false;
  }

  // state 定義を正規化して保持する
  normalizeState(def) {
    if (!def || typeof def !== "object") {
      throw new Error("state definition must be an object");
    }
    const id = String(def.id ?? "").trim();
    if (!id) {
      throw new Error("state id is required");
    }

    const action = def.action === undefined ? null : String(def.action);
    const clip = def.clip === undefined ? null : String(def.clip);
    if (!action && !clip) {
      throw new Error(`state "${id}" requires action or clip`);
    }
    const transitions = Array.isArray(def.transitions)
      ? def.transitions.map((transition, index) => this.normalizeTransition(id, transition, index))
      : [];

    return {
      id,
      action,
      clip,
      loop: def.loop === true,
      transitions,
      onEnter: typeof def.onEnter === "function" ? def.onEnter : null,
      onExit: typeof def.onExit === "function" ? def.onExit : null
    };
  }

  // 遷移定義を正規化する
  normalizeTransition(stateId, def, index) {
    if (!def || typeof def !== "object") {
      throw new Error(`transition[${index}] in state "${stateId}" must be an object`);
    }
    const to = String(def.to ?? "").trim();
    if (!to) {
      throw new Error(`transition[${index}] in state "${stateId}" requires "to"`);
    }
    if (typeof def.test !== "function") {
      throw new Error(`transition "${stateId}" -> "${to}" requires test(context)`);
    }
    const priority = Number.isFinite(def.priority) ? Number(def.priority) : 0;
    const cooldownMs = Number.isFinite(def.cooldownMs) ? Number(def.cooldownMs) : 0;
    return {
      to,
      test: def.test,
      priority,
      cooldownMs,
      label: def.label ? String(def.label) : `${stateId}->${to}`,
      enteredAtMs: -1
    };
  }

  // state を追加または上書きする
  addState(def) {
    const state = this.normalizeState(def);
    this.states.set(state.id, state);
    if (!this.initialState) {
      this.initialState = state.id;
    }
    return { ...state, transitions: state.transitions.map((item) => ({ ...item })) };
  }

  // state を返す
  getState(id) {
    const state = this.states.get(String(id ?? "").trim());
    return state
      ? { ...state, transitions: state.transitions.map((item) => ({ ...item })) }
      : null;
  }

  // 複数変数を一括更新する
  setVariables(object) {
    if (!object || typeof object !== "object") {
      return;
    }
    Object.assign(this.variables, object);
  }

  // 変数を 1 つ更新する
  setVariable(name, value) {
    this.variables[String(name)] = value;
  }

  // controller の対象再生を開始する
  playStateTarget(state, context, options = {}) {
    if (!state) {
      return -1;
    }
    let started = -1;
    if (state.action && typeof this.controller?.start === "function") {
      started = this.controller.start(state.action, options);
    } else if (state.action && typeof this.controller?.startAction === "function") {
      started = this.controller.startAction(state.action, options);
    } else if (state.clip && typeof this.controller?.startAnimation === "function") {
      started = this.controller.startAnimation(state.clip, options);
    } else if (state.clip && typeof this.controller?.restartAnimation === "function") {
      started = this.controller.restartAnimation(state.clip, options);
    }

    if (typeof state.onEnter === "function") {
      state.onEnter({
        stateId: state.id,
        context,
        machine: this
      });
    }
    this.playing = started !== -1;
    this.paused = false;
    return started;
  }

  // 強制的に state を切り替える
  setState(id, options = {}) {
    const stateId = String(id ?? "").trim();
    const nextState = this.states.get(stateId);
    if (!nextState) {
      throw new Error(`unknown state "${stateId}"`);
    }
    const context = {
      ...this.variables,
      ...(options.context ?? {})
    };
    const previousState = this.currentState;
    if (previousState?.id === nextState.id && options.force !== true) {
      return this.getCurrentState();
    }
    if (typeof previousState?.onExit === "function") {
      previousState.onExit({
        stateId: previousState.id,
        nextStateId: nextState.id,
        context,
        machine: this
      });
    }

    this.currentStateId = nextState.id;
    this.currentState = nextState;
    if (previousState) {
      const transitionInfo = this.currentTransition ?? {
        from: previousState.id,
        to: nextState.id,
        label: `${previousState.id}->${nextState.id}`
      };
      this.currentTransition = transitionInfo;
      this.lastTransition = { ...transitionInfo };
    } else {
      this.currentTransition = null;
      this.lastTransition = null;
    }
    this.started = true;
    this.playStateTarget(nextState, context, options.startOptions ?? {});
    return this.getCurrentState();
  }

  // 現在 state の候補遷移を選ぶ
  resolveTransition(context, nowMs) {
    const state = this.currentState;
    if (!state) {
      return null;
    }
    const transitions = [...state.transitions].sort((a, b) => b.priority - a.priority);
    for (let i = 0; i < transitions.length; i++) {
      const transition = transitions[i];
      if (transition.cooldownMs > 0 && transition.enteredAtMs >= 0) {
        if ((nowMs - transition.enteredAtMs) < transition.cooldownMs) {
          continue;
        }
      }
      if (transition.test(context, this) === true) {
        return transition;
      }
    }
    return null;
  }

  // 毎フレーム state 遷移と再生更新を進める
  update(context = {}, deltaMs = null) {
    this.setVariables(context);
    const mergedContext = {
      ...this.variables,
      ...context
    };
    let stateChangedThisFrame = false;

    if (!this.started && this.initialState) {
      this.setState(this.initialState, {
        context: mergedContext,
        force: true
      });
      stateChangedThisFrame = true;
    }

    if (!Number.isFinite(mergedContext.nowMs)) {
      throw new Error("AnimationState.update requires finite context.nowMs");
    }
    const nowMs = Number(mergedContext.nowMs);
    const transition = this.resolveTransition(mergedContext, nowMs);
    if (transition) {
      transition.enteredAtMs = nowMs;
      this.currentTransition = {
        from: this.currentState?.id ?? null,
        to: transition.to,
        label: transition.label
      };
      this.setState(transition.to, {
        context: mergedContext,
        startOptions: { entryDurationMs: mergedContext.entryDurationMs }
      });
      stateChangedThisFrame = true;
    }

    let playResult = -1;
    if (this.currentState?.action) {
      // 入力直後の開始 frame で補間を圧縮しないため、
      // state を切り替えた frame では play をまだ進めない
      if (!stateChangedThisFrame) {
        if (typeof this.controller?.play === "function") {
          playResult = this.controller.play(deltaMs);
        } else if (typeof this.controller?.playAction === "function") {
          playResult = this.controller.playAction(deltaMs);
        }
      }
      const actionInfo = typeof this.controller?.getActionInfo === "function"
        ? this.controller.getActionInfo()
        : null;
      this.playing = actionInfo?.playing ?? this.playing;
      this.paused = actionInfo?.paused ?? this.paused;
    } else if (this.currentState?.clip) {
      if (typeof this.controller?.playAnimation === "function") {
        playResult = this.controller.playAnimation(this.currentState.clip, deltaMs);
      }
    }

    return {
      state: this.getCurrentState(),
      transition: this.getCurrentTransition(),
      playResult
    };
  }

  // 現在 state の外部参照用 object を返す
  getCurrentState() {
    return this.currentState
      ? {
          id: this.currentState.id,
          action: this.currentState.action,
          clip: this.currentState.clip,
          loop: this.currentState.loop
        }
      : null;
  }

  // 現在遷移の要約を返す
  getCurrentTransition() {
    return this.currentTransition
      ? { ...this.currentTransition }
      : (this.lastTransition ? { ...this.lastTransition } : null);
  }

  // HUD / diagnostics 向けの短い情報を返す
  getDebugInfo() {
    const actionInfo = typeof this.controller?.getActionInfo === "function"
      ? this.controller.getActionInfo()
      : null;
    return {
      stateId: this.currentState?.id ?? null,
      actionId: this.currentState?.action ?? actionInfo?.actionId ?? null,
      clipId: this.currentState?.clip ?? null,
      transitionTo: this.currentTransition?.to ?? null,
      transitionLabel: this.currentTransition?.label ?? null,
      playing: actionInfo?.playing ?? this.playing,
      paused: actionInfo?.paused ?? this.paused
    };
  }
}
