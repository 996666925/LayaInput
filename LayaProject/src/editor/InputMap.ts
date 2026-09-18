/**
 * Godot `InputMap` 单例的移植。
 *
 * 负责「动作（action）」与「输入事件（InputEvent）」之间的绑定关系，
 * 以及每个动作的死区（deadzone）。
 *
 * 本文件不依赖 Laya 运行时，编辑器扩展可以安全引入。
 */

import { ActionMatchResult, InputEvent, InputEventAction } from "./InputEvent";

/** 一个动作的绑定数据。 */
export interface InputMapAction {
  /** 动作名。 */
  name: string;
  /** 死区，取值 0 ~ 1。 */
  deadzone: number;
  /** 绑定的事件列表。 */
  events: InputEvent[];
}

/** 默认死区，与 Godot 一致。 */
export const DEFAULT_DEADZONE = 0.2;

/** 输入映射编辑器默认写入的资源路径。 */
export const DEFAULT_INPUT_MAP_PATH = "resources/inputmap.json";

function sanitizeDeadzone(deadzone: number): number {
  if (!Number.isFinite(deadzone)) return DEFAULT_DEADZONE;
  return Math.min(Math.max(deadzone, 0), 1);
}

function sanitizeStrength(strength: number): number {
  if (!Number.isFinite(strength)) return 0;
  return Math.min(Math.max(strength, 0), 1);
}

/** 动作匹配的结果，等价于 Godot 的 `InputMap.event_get_action_status()` 返回值。 */
export interface ActionStatus {
  /** 事件是否命中该动作；释放事件命中时也为 true。 */
  active: boolean;
  /** 是否处于按下状态。 */
  pressed: boolean;
  /** 归一化后的强度。 */
  strength: number;
  /** 原始强度。 */
  rawStrength: number;
}

/** 把原始强度按死区归一化，等价于 Godot 的强度换算。 */
export function normalizeStrength(rawStrength: number, deadzone: number): number {
  if (!Number.isFinite(rawStrength) || rawStrength <= 0) return 0;
  deadzone = sanitizeDeadzone(deadzone);
  if (rawStrength < deadzone) return 0;
  if (deadzone >= 1) return 0;
  return Math.min((rawStrength - deadzone) / (1 - deadzone), 1);
}

/** 输入映射表。等价于 Godot 的 `InputMap` 单例（autoload）。 */
export class InputMap {
  private static _singleton: InputMap | null = null;

  /**
   * 自动载入的资源路径。默认与输入映射编辑器的保存路径一致；
   * 若项目把映射文件保存到其他位置，请在第一次使用 `Input` 前修改它。
   */
  static defaultFile: string = DEFAULT_INPUT_MAP_PATH;

  private _actions: Map<string, InputMapAction> = new Map();
  /** 由代码强制设置的动作状态（`Input.actionPress` / `Input.setAxis`）。 */
  private _forced: Map<string, { pressed: boolean; strength: number }> = new Map();
  private _revision = 0;
  private _defaultLoadStarted = false;
  private _defaultLoadPromise: Promise<void> | null = null;

  /** 获取单例。等价于 Godot 的 `InputMap.get_singleton()`。 */
  static get singleton(): InputMap {
    if (!InputMap._singleton) InputMap._singleton = new InputMap();
    return InputMap._singleton;
  }

  /** 每次映射或强制状态发生变化时递增，供运行时缓存失效使用。 */
  get revision(): number {
    return this._revision;
  }

  private _touch(): void {
    this._revision++;
  }

  /**
   * 通过 Laya 资源系统自动载入默认输入映射。
   *
   * `Input.install()` 会自动调用此方法，因此正常使用 `Input` 时无需再手动
   * `loadFromFile()`。引擎加载器尚未就绪时不记录本次尝试，后续初始化会重试。
   */
  ensureDefaultLoaded(): Promise<void> | null {
    if (this._defaultLoadPromise) return this._defaultLoadPromise;
    if (this._defaultLoadStarted || this._actions.size > 0) return null;

    const engine: any = (globalThis as any).Laya;
    const loader: any = engine && engine.loader;
    if (!loader || typeof loader.load !== "function") return null;

    this._defaultLoadStarted = true;
    const url = InputMap.defaultFile;
    const startRevision = this._revision;
    let loaded = false;
    const loadPromise = Promise.resolve()
      .then(() => loader.load(url, engine.Loader?.JSON ?? "json"))
      .then((resource: any) => {
        const data = resource && typeof resource === "object" && "data" in resource ? resource.data : resource;
        if (!data) {
          throw new Error("资源为空");
        }
        if (this._revision !== startRevision && this._actions.size > 0) {
          loaded = true;
          console.warn(`[InputMap] 默认映射载入完成前映射已被修改，已忽略：${url}`);
          return;
        }
        this.loadFromJSON(typeof data === "string" ? JSON.parse(data) : data);
        loaded = true;
      })
      .catch((error: unknown) => {
        console.warn(`[InputMap] 载入输入映射失败：${url}`, error);
      })
      .finally(() => {
        if (!loaded) {
          this._defaultLoadStarted = false;
          this._defaultLoadPromise = null;
        }
      });
    this._defaultLoadPromise = loadPromise;
    return loadPromise;
  }

  /** 确保默认映射已开始载入，并等待其完成。 */
  get ready(): Promise<void> {
    return this.ensureDefaultLoaded() ?? Promise.resolve();
  }

  /* ------------------------------------------------------------------ */
  /*                        动作（Action）管理                          */
  /* ------------------------------------------------------------------ */

  /** 是否存在该动作。 */
  hasAction(action: string): boolean {
    return this._actions.has(action);
  }

  /** 返回所有动作名。等价于 `InputMap.get_actions()`。 */
  getActions(): string[] {
    return Array.from(this._actions.keys());
  }

  /**
   * 新增一个动作。等价于 `InputMap.add_action(action, deadzone)`。
   * 若已存在则只更新死区。
   */
  addAction(action: string, deadzone: number = DEFAULT_DEADZONE): void {
    if (!action) return;
    deadzone = sanitizeDeadzone(deadzone);
    const existing = this._actions.get(action);
    if (existing) {
      if (existing.deadzone === deadzone) return;
      existing.deadzone = deadzone;
      this._touch();
      return;
    }
    this._actions.set(action, { name: action, deadzone, events: [] });
    this._touch();
  }

  /** 删除动作。等价于 `InputMap.erase_action()`。 */
  eraseAction(action: string): void {
    const actionDeleted = this._actions.delete(action);
    const forcedDeleted = this._forced.delete(action);
    if (actionDeleted || forcedDeleted) this._touch();
  }

  /** 重命名动作，同时保留原有绑定。 */
  renameAction(action: string, newName: string): boolean {
    const data = this._actions.get(action);
    if (!data || !newName || this._actions.has(newName)) return false;
    this._actions.delete(action);
    data.name = newName;
    this._actions.set(newName, data);
    const forced = this._forced.get(action);
    if (forced) {
      this._forced.delete(action);
      this._forced.set(newName, forced);
    }
    this._touch();
    return true;
  }

  /** 删除全部动作。 */
  clear(): void {
    if (this._actions.size === 0 && this._forced.size === 0) return;
    this._actions.clear();
    this._forced.clear();
    this._touch();
  }

  /** 设置动作死区。等价于 `InputMap.action_set_deadzone()`。 */
  actionSetDeadzone(action: string, deadzone: number): void {
    const data = this._actions.get(action);
    const value = sanitizeDeadzone(deadzone);
    if (data && data.deadzone !== value) {
      data.deadzone = value;
      this._touch();
    }
  }

  /** 读取动作死区。等价于 `InputMap.action_get_deadzone()`。 */
  actionGetDeadzone(action: string): number {
    const data = this._actions.get(action);
    return data ? data.deadzone : DEFAULT_DEADZONE;
  }

  /* ------------------------------------------------------------------ */
  /*                        事件（Event）绑定                           */
  /* ------------------------------------------------------------------ */

  /** 给动作添加一个绑定事件。等价于 `InputMap.action_add_event()`。 */
  actionAddEvent(action: string, event: InputEvent): void {
    if (!this.hasAction(action)) this.addAction(action);
    this._actions.get(action)!.events.push(event);
    this._touch();
  }

  /** 动作是否已绑定该事件（全字段比较）。等价于 `InputMap.action_has_event()`。 */
  actionHasEvent(action: string, event: InputEvent): boolean {
    const data = this._actions.get(action);
    if (!data) return false;
    return data.events.some((e) => e.isMatch(event));
  }

  /** 移除动作上的指定绑定事件。等价于 `InputMap.action_erase_event()`。 */
  actionEraseEvent(action: string, event: InputEvent): void {
    const data = this._actions.get(action);
    if (!data) return;
    const index = data.events.findIndex((e) => e.isMatch(event));
    if (index >= 0) {
      data.events.splice(index, 1);
      this._touch();
    }
  }

  /** 移除动作上的全部绑定事件。等价于 `InputMap.action_erase_events()`。 */
  actionEraseEvents(action: string): void {
    const data = this._actions.get(action);
    if (data && data.events.length > 0) {
      data.events.length = 0;
      this._touch();
    }
  }

  /** 读取动作绑定的全部事件。等价于 `InputMap.action_get_events()`。 */
  actionGetEvents(action: string): InputEvent[] {
    const data = this._actions.get(action);
    return data ? data.events.slice() : [];
  }

  /**
   * 判断一个输入事件是否触发指定动作。
   * 等价于 `InputMap.event_is_action()`。
   */
  eventIsAction(event: InputEvent, action: string, exactMatch: boolean = false): boolean {
    return this.eventGetActionStatus(event, action, exactMatch).active;
  }

  /**
   * 获取事件的完整动作状态。
   * 等价于 `InputMap.event_get_action_status()`。
   */
  eventGetActionStatus(event: InputEvent, action: string, exactMatch: boolean = false): ActionStatus {
    const empty: ActionStatus = { active: false, pressed: false, strength: 0, rawStrength: 0 };
    if (!event || !action) return empty;
    const data = this._actions.get(action);
    if (!data) return empty;

    // 1) InputEventAction 直接命中动作名。
    if (event instanceof InputEventAction) {
      if (event.action !== action) return empty;
      const rawStrength = event.isPressed() ? sanitizeStrength(event.strength === 0 ? 1 : event.strength) : 0;
      return {
        active: true,
        pressed: event.isPressed(),
        strength: rawStrength,
        rawStrength,
      };
    }

    // 2) 依次尝试动作上绑定的每个事件。
    let pressed = false;
    let rawStrength = 0;
    let matched = false;
    const out: ActionMatchResult = { pressed: false, strength: 0 };
    for (const rule of data.events) {
      out.pressed = false;
      out.strength = 0;
      if (!rule.actionMatch(event, out, data.deadzone, exactMatch)) continue;
      matched = true;
      pressed = pressed || out.pressed;
      rawStrength = Math.max(rawStrength, out.strength);
    }
    if (!matched) return empty;

    return {
      active: true,
      pressed,
      strength: normalizeStrength(rawStrength, data.deadzone),
      rawStrength,
    };
  }

  /* ------------------------------------------------------------------ */
  /*                          强制动作状态                              */
  /* ------------------------------------------------------------------ */

  /** 由 `Input.actionPress()` 写入。 */
  setForcedAction(action: string, pressed: boolean, strength: number = 1): void {
    if (!this.hasAction(action)) this.addAction(action);
    const value = { pressed, strength: pressed ? sanitizeStrength(strength) : 0 };
    const previous = this._forced.get(action);
    if (previous && previous.pressed === value.pressed && previous.strength === value.strength) return;
    this._forced.set(action, value);
    this._touch();
  }

  /** 读取强制动作状态，不存在时返回 null。 */
  getForcedAction(action: string): { pressed: boolean; strength: number } | null {
    const value = this._forced.get(action);
    return value ? { pressed: value.pressed, strength: value.strength } : null;
  }

  /** 清空所有强制状态（抬起全部虚拟动作）。 */
  clearForcedActions(): void {
    if (this._forced.size === 0) return;
    this._forced.clear();
    this._touch();
  }

  /* ------------------------------------------------------------------ */
  /*                           序列化                                   */
  /* ------------------------------------------------------------------ */

  /** 导出为纯数据对象；编辑器扩展写入的 JSON 就是这个结构。 */
  toJSON(): any {
    const actions: any[] = [];
    for (const data of this._actions.values()) {
      actions.push({
        name: data.name,
        deadzone: data.deadzone,
        events: data.events.map((e) => e.toJSON()),
      });
    }
    return { version: 1, actions };
  }

  /**
   * 从纯数据对象载入。对应 Godot 的 `InputMap.load_from_project_settings()`，
   * 数据格式由本项目自定义（见 `toJSON`）。
   */
  loadFromJSON(data: any): void {
    this.clear();
    if (!data) return;
    const actions = Array.isArray(data) ? data : data.actions;
    if (!Array.isArray(actions)) return;
    for (const raw of actions) {
      if (!raw || !raw.name) continue;
      this.addAction(raw.name, typeof raw.deadzone === "number" ? raw.deadzone : DEFAULT_DEADZONE);
      const rawEvents = Array.isArray(raw.events) ? raw.events : [];
      for (const rawEvent of rawEvents) {
        const event = InputEvent.fromJSON(rawEvent);
        if (event) this.actionAddEvent(raw.name, event);
      }
    }
  }

  /**
   * 从 URL 载入映射表（浏览器环境下使用 `fetch`）。
   * 默认的 `resources/inputmap.json` 会由 `Input` 自动通过 `Laya.loader` 载入；
   * 此方法仅用于自定义路径或非 Laya 环境。
   */
  async loadFromFile(url: string): Promise<void> {
    if (typeof fetch !== "function") {
      console.warn("[InputMap] 当前环境不支持 fetch，无法从文件载入输入映射");
      return;
    }
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[InputMap] 载入输入映射失败：${url} (${response.status})`);
      return;
    }
    this.loadFromJSON(await response.json());
  }
}
