// ---------------------------------------------
// GameStateManager.js 2026/07/25
//   Copyright (c) 2026 Jun Mizutani,
//   released under the MIT open source license.
// ---------------------------------------------

export default class GameStateManager {
  // ゲーム全体の scene phase を扱う最小 state machine
  // - WebgApp の core ではなく、game app 側で必要な時だけ保持する
  constructor(options = {}) {
    this.initialState = options.initialState ?? null;
    this.states = new Map();
    this.variables = { ...(options.variables ?? {}) };
    this.currentStateId = null;
    this.currentState = null;
    this.currentTransition = null;
    this.lastTransition = null;
    this.started = false;
    this.paused = false;
  }

  // 状態を検証し、後続処理が扱える共通形式へ整える
  normalizeState(def) {
    if (!def || typeof def !== "object") {
      throw new Error("state definition must be an object");
    }
    const id = String(def.id ?? "").trim();
    if (!id) {
      throw new Error("state id is required");
    }
    const transitions = Array.isArray(def.transitions)
      ? def.transitions.map((transition, index) => this.normalizeTransition(id, transition, index))
      : [];
    return {
      id,
      data: def.data ?? null,
      loop: def.loop === true,
      transitions,
      onEnter: typeof def.onEnter === "function" ? def.onEnter : null,
      onExit: typeof def.onExit === "function" ? def.onExit : null,
      onUpdate: typeof def.onUpdate === "function" ? def.onUpdate : null
    };
  }

  // 遷移を検証し、後続処理が扱える共通形式へ整える
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
    return {
      to,
      test: def.test,
      priority: Number.isFinite(def.priority) ? Number(def.priority) : 0,
      cooldownMs: Number.isFinite(def.cooldownMs) ? Number(def.cooldownMs) : 0,
      label: def.label ? String(def.label) : `${stateId}->${to}`,
      enteredAtMs: -1
    };
  }

  // 状態を対象へ追加し、後続処理から参照できるようにする
  addState(def) {
    const state = this.normalizeState(def);
    this.states.set(state.id, state);
    if (!this.initialState) {
      this.initialState = state.id;
    }
    return this.getState(state.id);
  }

  // 状態を現在の入力と状態から求め、呼び出し元へ返す
  getState(id) {
    const state = this.states.get(String(id ?? "").trim());
    return state
      ? {
        ...state,
        transitions: state.transitions.map((item) => ({ ...item }))
      }
      : null;
  }

  // `variables`を受け取り、現在の設定と後続処理へ反映する
  setVariables(object) {
    if (!object || typeof object !== "object") return;
    Object.assign(this.variables, object);
  }

  setVariable(name, value) {
    this.variables[String(name)] = value;
  }

  // 現在のゲーム状態を複製して返す
  getCurrentState() {
    return this.currentState ? {
      ...this.currentState,
      transitions: this.currentState.transitions.map((item) => ({ ...item }))
    } : null;
  }

  getCurrentTransition() {
    return this.currentTransition ? { ...this.currentTransition } : null;
  }

  // 遷移を現在の入力と状態から求め、呼び出し元へ返す
  resolveTransition(context, nowMs) {
    const state = this.currentState;
    if (!state) return null;
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

  // `playStateTarget`は選択中の音声またはアニメーションの再生状態を更新する
  playStateTarget(state, context, options = {}) {
    if (typeof state.onEnter === "function") {
      state.onEnter({
        stateId: state.id,
        context,
        machine: this,
        data: state.data
      });
    }
    return options;
  }

  // 状態を受け取り、現在の設定と後続処理へ反映する
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

  // このインスタンスを現在の入力と実行状態に合わせて更新する
  update(context = {}, deltaMs = null) {
    if (this.paused) {
      this.setVariables(context);
      return {
        state: this.getCurrentState(),
        transition: this.getCurrentTransition(),
        paused: true,
        deltaMs
      };
    }

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

    const nowMs = Number.isFinite(mergedContext.nowMs) ? mergedContext.nowMs : Date.now();
    const transition = this.resolveTransition(mergedContext, nowMs);
    if (transition) {
      transition.enteredAtMs = nowMs;
      this.currentTransition = {
        from: this.currentState?.id ?? null,
        to: transition.to,
        label: transition.label
      };
      this.setState(transition.to, {
        context: mergedContext
      });
      stateChangedThisFrame = true;
    }

    if (!stateChangedThisFrame && typeof this.currentState?.onUpdate === "function") {
      this.currentState.onUpdate({
        stateId: this.currentState.id,
        context: mergedContext,
        machine: this,
        deltaMs
      });
    }

    return {
      state: this.getCurrentState(),
      transition: this.getCurrentTransition(),
      deltaMs,
      nowMs,
      paused: this.paused
    };
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  // このインスタンスを初期状態へ戻し、前回の状態を残さない
  reset() {
    this.currentStateId = null;
    this.currentState = null;
    this.currentTransition = null;
    this.lastTransition = null;
    this.started = false;
    this.paused = false;
  }
}
