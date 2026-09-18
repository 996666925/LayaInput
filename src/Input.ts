/**
 * Godot `Input` 单例的移植（LayaAir 运行时版本）。
 *
 * 覆盖 Godot 4.x `Input` 类的全部常用方法：
 * 动作查询、轴 / 向量、按键 / 鼠标 / 手柄查询、鼠标模式、震动、重力传感器等。
 *
 * 说明：
 * - Godot 用 `KEY_*` / `MouseButton` / `JoyButton` 等全局枚举，这里收在 `InputEnums.ts` 中。
 * - 浏览器没有通用手柄 API，手柄通过 Web Gamepad API 每帧轮询，效果等价于 Godot 的 SDL 手柄。
 * - `just_pressed` / `just_released` 由「输入帧」驱动：一个输入帧 = 一次 `Input.update()` 结算。
 *   边沿在事件落地的那一刻就生效，之后一直可以被读到，因此不管 `Input.update()` 与游戏逻辑
 *   在引擎帧内谁先谁后，按键都不会被漏掉；同一帧内多次查询结果一致，且每个边沿只会上报一次。
 *
 * 用法：
 * ```ts
 * Input.isActionPressed("move_forward");
 * const dir = Input.getVector("move_left", "move_right", "move_up", "move_down");
 * ```
 */

import {
  CursorShape,
  JoyAxis,
  JoyButton,
  Key,
  MouseButton,
  MouseButtonMask,
  MouseMode,
  cursorShapeToCss,
  joyAxisFromGamepadIndex,
  joyAxisFromString,
  joyAxisToString,
  joyButtonFromGamepadIndex,
  joyButtonFromString,
  joyButtonToString,
  keyFromDomCode,
  keyFromDomKey,
} from "./InputEnums";
import {
  ActionMatchResult,
  InputEvent,
  InputEventAction,
  InputEventJoypadButton,
  InputEventJoypadMotion,
  InputEventKey,
  InputEventMouseButton,
  InputEventMouseMotion,
  InputEventScreenDrag,
  InputEventScreenTouch,
  Quat,
  Vec2,
  Vec3,
  vec2,
  vec3,
} from "./InputEvent";
import { InputMap, normalizeStrength } from "./InputMap";
import { deviceSensors } from "./internal/DeviceSensors";

/** Web Gamepad 标准布局的按键索引 -> Godot `JoyButton`。 */
const GAMEPAD_BUTTON_MAP: Readonly<Record<number, JoyButton>> = {
  0: JoyButton.A,
  1: JoyButton.B,
  2: JoyButton.X,
  3: JoyButton.Y,
  4: JoyButton.LEFT_SHOULDER,
  5: JoyButton.RIGHT_SHOULDER,
  6: JoyButton.MAX, // 左扳机在标准布局里是轴，不参与按键映射
  7: JoyButton.MAX,
  8: JoyButton.BACK,
  9: JoyButton.START,
  10: JoyButton.LEFT_STICK,
  11: JoyButton.RIGHT_STICK,
  12: JoyButton.DPAD_UP,
  13: JoyButton.DPAD_DOWN,
  14: JoyButton.DPAD_LEFT,
  15: JoyButton.DPAD_RIGHT,
  16: JoyButton.GUIDE,
};

/** 手柄连接状态变化的回调。等价于 Godot 的 `joy_connection_changed` 信号。 */
export type JoyConnectionChangedCallback = (device: number, connected: boolean) => void;

/** 单个手柄的运行时状态。 */
interface JoypadState {
  index: number;
  name: string;
  guid: string;
  connected: boolean;
  /** 按 Godot `JoyButton` 索引存放的按下状态。 */
  buttons: boolean[];
  /** 按 Godot `JoyAxis` 索引存放的轴值。 */
  axes: number[];
  /** 上个快照，用于生成边沿事件。 */
  prevButtons: boolean[];
  prevAxes: number[];
}

/**
 * Godot `Input` 单例。所有成员均为静态，直接以 `Input.xxx()` 调用即可。
 */
export class Input {
  /* ------------------------------------------------------------------ */
  /*                            内部状态                                */
  /* ------------------------------------------------------------------ */

  private static _installed = false;
  private static _installing = false;
  /** 键盘监听是否已挂上。 */
  private static _keyboardListenersReady = false;
  /** Laya 舞台键盘监听是否已挂上（仅在没有 DOM 键盘时作为回退）。 */
  private static _stageKeyboardListenersReady = false;
  /** 舞台鼠标监听是否已挂上。 */
  private static _stageListenersReady = false;

  /** 是否由 `Laya.timer.frameLoop` 自动驱动每帧结算。 */
  static autoFrameUpdate = true;

  /** 逻辑键按下集合（受键盘布局影响，对应 `KeyboardEvent.key`）。 */
  private static _pressedKeys: Set<Key> = new Set();
  /** 物理键按下集合（对应 `KeyboardEvent.code`）。 */
  private static _pressedPhysicalKeys: Set<Key> = new Set();
  /** 按键标签集合，供只配置了 `keyLabel` 的映射使用。 */
  private static _pressedKeyLabels: Set<Key> = new Set();
  /** 鼠标按键按下集合。 */
  private static _pressedMouseButtons: Set<MouseButton> = new Set();
  private static _mouseButtonMask = 0;

  private static _mousePosition: Vec2 = vec2();
  private static _mouseVelocity: Vec2 = vec2();
  private static _mouseScreenVelocity: Vec2 = vec2();
  private static _lastMousePosition: Vec2 = null as any;
  private static _lastMouseTime = 0;

  /** 当前帧快照：处于按下状态的动作。 */
  private static _actionStates: Map<string, { pressed: boolean; strength: number; rawStrength: number }> = new Map();
  /** 最近一次同步到动作快照的 InputMap 版本。 */
  private static _inputMapRevision = -1;

  /** 上一帧用来判断“是否进入了新的一帧”的引擎时间戳。 */
  private static _lastTickStamp = -1;

  /**
   * 边沿（just_pressed / just_released）分三层保存，
   * 目标：每个边沿“一定能被读到、而且只上报一次”。
   *
   * - `_fresh*`：本帧新产生、还没有被任何查询读到的边沿；
   * - `_carry*`：上一帧产生但一直没人读的边沿，允许在本帧补读一次。
   *   这一层是关键：`Input.update()` 与游戏逻辑在同一引擎帧里的先后顺序无法保证，
   *   没有它就会出现“按键只发生在上一帧、本帧查不到”的问题；
   * - `_read*`：本帧已经被读到过的边沿，保证同一帧内重复查询结果一致，且不会跨帧重复上报。
   */
  private static _freshDown: Set<string> = new Set();
  private static _freshUp: Set<string> = new Set();
  private static _carryDown: Set<string> = new Set();
  private static _carryUp: Set<string> = new Set();
  private static _readDown: Set<string> = new Set();
  private static _readUp: Set<string> = new Set();
  private static _freshExactDown: Set<string> = new Set();
  private static _freshExactUp: Set<string> = new Set();
  private static _carryExactDown: Set<string> = new Set();
  private static _carryExactUp: Set<string> = new Set();
  private static _readExactDown: Set<string> = new Set();
  private static _readExactUp: Set<string> = new Set();

  private static _useAccumulatedInput = true;

  private static _mouseMode: MouseMode = MouseMode.VISIBLE;
  private static _cursorShape: CursorShape = CursorShape.ARROW;
  /** 自定义光标：形状 -> CSS cursor 值。 */
  private static _customCursors: Map<CursorShape, string> = new Map();
  private static _emulateMouseFromTouch = true;
  private static _emulateTouchFromMouse = true;
  /** 焦点落在可见的 HTML 输入控件上时是否忽略键盘。 */
  private static _ignoreKeysInTextInput = true;

  private static _frameLoopRegistered = false;

  private static _ignoringJoypad = false;
  private static _ignoreJoypadOnUnfocused = true;
  private static _joypads: Map<number, JoypadState> = new Map();
  /** 由 `parseInputEvent()` 注入、独立于浏览器 Gamepad 快照的手柄状态。 */
  private static _injectedJoyButtons: Map<number, Set<JoyButton>> = new Map();
  private static _injectedJoyAxes: Map<number, Map<JoyAxis, number>> = new Map();
  private static _joyConnectionListeners: JoyConnectionChangedCallback[] = [];
  /** 手柄震动状态：设备 -> { 弱马达, 强马达, 时长(ms), 结束时间(ms) }。 */
  private static _joyVibrations: Map<number, { weak: number; strong: number; duration: number; endTime: number }> =
    new Map();
  /** SDL 风格的手柄映射字符串（浏览器无法应用，仅做记录，便于接口对齐）。 */
  private static _joyMappings: Map<string, string> = new Map();

  private static _imeText = "";

  /* ------------------------------------------------------------------ */
  /*                          安装 / 卸载                               */
  /* ------------------------------------------------------------------ */

  /**
   * 安装全局输入监听。首次调用任意查询接口时会自动安装，一般无需手动调用。
   *
   * 安装是「可自愈」的：键盘监听、舞台鼠标监听、帧循环各自独立记录状态，
   * 任何一项当次装不上（例如 `Laya.stage` / `Laya.timer` 还没就绪）都会在下次查询时自动补上，
   * 不会出现“第一次调用时环境没准备好，之后再也装不上”的情况。
   */
  static install(): void {
    if (Input._installing) return;
    Input._installing = true;
    try {
      // 编辑器默认将输入映射写入 assets/resources/inputmap.json。
      // 使用 Laya.loader 才能正确处理发布路径、预加载和小游戏平台。
      void InputMap.singleton.ensureDefaultLoaded();
      Input._installKeyboardListeners();
      Input._installStageListeners();
      Input._registerFrameLoop();
      Input._installed = Input._keyboardListenersReady || Input._stageListenersReady;
    } finally {
      Input._installing = false;
    }
  }

  /**
   * 挂键盘监听。
   *
   * 用**捕获阶段**监听：这样即使页面里其它监听器（引擎、IDE、业务代码）调用了
   * `stopPropagation()`，也不会把按键吞掉，避免出现“在 onUpdate 里怎么按都读不到”的情况。
   */
  private static _installKeyboardListeners(): void {
    if (Input._keyboardListenersReady) return;
    const win: any = typeof window !== "undefined" ? window : null;
    if (!win || typeof win.addEventListener !== "function") return;
    win.addEventListener("keydown", Input.onDomKeyDown, true);
    win.addEventListener("keyup", Input.onDomKeyUp, true);
    win.addEventListener("blur", Input.onWindowBlur, false);
    Input._keyboardListenersReady = true;
    // 若运行时稍后才提供 window，移除之前挂在 Stage 上的回退监听，避免同一按键重复处理。
    Input._uninstallStageKeyboardListeners();
  }

  /** 挂舞台鼠标监听；`Laya.stage` 还没就绪时留到下次查询再补。 */
  private static _installStageListeners(): void {
    if (Input._stageListenersReady) return;
    const stage: any = Input._stage();
    if (!stage || typeof stage.on !== "function") return;
    // 直接用事件名字符串（等价于 `Laya.Event.*`），
    // 这样引擎还没初始化、拿不到 `Laya.Event` 时也能装上。
    stage.on("mousedown", Input, Input.onStageMouseDown);
    stage.on("mouseup", Input, Input.onStageMouseUp);
    stage.on("rightmousedown", Input, Input.onStageMouseDown);
    stage.on("rightmouseup", Input, Input.onStageMouseUp);
    stage.on("mousemove", Input, Input.onStageMouseMove);
    stage.on("mousewheel", Input, Input.onStageMouseWheel);
    Input._installStageKeyboardListeners(stage);
    Input._stageListenersReady = true;
  }

  /**
   * 无 DOM 的 Laya Native / 小游戏运行时通过 Stage 派发键盘事件。
   * 浏览器环境优先使用 window 的捕获监听，避免同一原生事件被 Laya 再派发一次。
   */
  private static _installStageKeyboardListeners(stage: any): void {
    if (Input._keyboardListenersReady || Input._stageKeyboardListenersReady) return;
    stage.on("keydown", Input, Input.onStageKeyDown);
    stage.on("keyup", Input, Input.onStageKeyUp);
    Input._stageKeyboardListenersReady = true;
  }

  private static _uninstallStageKeyboardListeners(stage: any = Input._stage()): void {
    if (!Input._stageKeyboardListenersReady) return;
    if (stage && typeof stage.off === "function") {
      stage.off("keydown", Input, Input.onStageKeyDown);
      stage.off("keyup", Input, Input.onStageKeyUp);
    }
    Input._stageKeyboardListenersReady = false;
  }

  /** 取 Laya 引擎入口。引擎尚未加载时返回 `null`，绝不抛异常。 */
  private static _engine(): any {
    return typeof Laya !== "undefined" ? (Laya as any) : null;
  }

  /** 取舞台对象，引擎未初始化时返回 `null`。 */
  private static _stage(): any {
    const engine = Input._engine();
    return engine && engine.stage ? engine.stage : null;
  }

  /**
   * 开启 / 关闭由 `Laya.timer` 驱动的每帧结算。
   * 如果你的项目更喜欢自己在脚本的 `onLateUpdate` 里调用 `Input.update()`，
   */
  static setAutoFrameUpdate(enable: boolean): void {
    Input.autoFrameUpdate = enable;
    if (enable) Input._registerFrameLoop();
    else Input._unregisterFrameLoop();
  }

  private static _registerFrameLoop(): void {
    if (Input._frameLoopRegistered || !Input.autoFrameUpdate) return;
    const engine = Input._engine();
    const timer: any = engine ? engine.timer : null;
    if (!timer || typeof timer.frameLoop !== "function") return; // 下次查询时再补
    timer.frameLoop(1, Input, Input.update);
    Input._frameLoopRegistered = true;
  }

  private static _unregisterFrameLoop(): void {
    if (!Input._frameLoopRegistered) return;
    Input._frameLoopRegistered = false;
    const engine = Input._engine();
    const timer: any = engine ? engine.timer : null;
    if (timer && typeof timer.clear === "function") timer.clear(Input, Input.update);
  }

  /** 卸载全局输入监听并清空所有状态。 */
  static uninstall(): void {
    const stage: any = Input._stage();
    if (Input._stageListenersReady && stage && typeof stage.off === "function") {
      stage.off("mousedown", Input, Input.onStageMouseDown);
      stage.off("mouseup", Input, Input.onStageMouseUp);
      stage.off("rightmousedown", Input, Input.onStageMouseDown);
      stage.off("rightmouseup", Input, Input.onStageMouseUp);
      stage.off("mousemove", Input, Input.onStageMouseMove);
      stage.off("mousewheel", Input, Input.onStageMouseWheel);
    }
    Input._uninstallStageKeyboardListeners(stage);
    Input._stageListenersReady = false;

    const win: any = typeof window !== "undefined" ? window : null;
    if (Input._keyboardListenersReady && win) {
      win.removeEventListener("keydown", Input.onDomKeyDown, true);
      win.removeEventListener("keyup", Input.onDomKeyUp, true);
      win.removeEventListener("blur", Input.onWindowBlur, false);
    }
    Input._keyboardListenersReady = false;

    Input._unregisterFrameLoop();
    deviceSensors.unbind();
    Input._installed = false;
    Input.releaseAllInputs();
  }

  /** 是否有输入监听已安装。 */
  static get installed(): boolean {
    return Input._installed;
  }

  /**
   * 排查用：返回输入系统当前的连接状态。
   *
   * 如果在 `onUpdate` 里读不到输入，先打印这个：
   * - `keyboardListeners` 为 false → 键盘监听没挂上（环境里没有 `window`）；
   * - `stageListeners` 为 false → `Laya.stage` 还没就绪；
   * - `frameLoop` 为 false → 帧循环没挂上，此时边沿仍能在查询时自动推进，但手柄轴需要手动 `Input.update()`；
   * - `actions` 为 0 → 输入映射表是空的，动作当然永远是 false。
   */
  static getDebugInfo(): Record<string, any> {
    const engine = Input._engine();
    return {
      installed: Input._installed,
      keyboardListeners: Input._keyboardListenersReady,
      stageKeyboardListeners: Input._stageKeyboardListenersReady,
      stageListeners: Input._stageListenersReady,
      frameLoop: Input._frameLoopRegistered,
      hasEngine: !!engine,
      hasStage: !!Input._stage(),
      hasTimer: !!(engine && engine.timer),
      engineFrame: Input._engineFrameStamp(),
      actions: InputMap.singleton.getActions().length,
      actionNames: InputMap.singleton.getActions(),
      pressedKeys: Input._pressedKeys.size,
      pressedMouseButtons: Input._pressedMouseButtons.size,
      // 焦点在 HTML 输入框里时键盘会被故意忽略（避免打字触发游戏输入）
      textInputFocused: Input._isTextInputFocused(),
      focusedElement: Input._describeActiveElement(),
    };
  }

  /** 当前焦点元素的简要描述，便于排查「按键被谁吃了」。 */
  private static _describeActiveElement(): string {
    if (typeof document === "undefined") return "(无 document)";
    const active: any = document.activeElement;
    if (!active) return "(无焦点元素)";
    const tag = String(active.tagName || "?").toLowerCase();
    const id = active.id ? `#${active.id}` : "";
    let size = "";
    try {
      if (typeof active.getBoundingClientRect === "function") {
        const rect = active.getBoundingClientRect();
        if (rect) size = ` ${Math.round(rect.width)}x${Math.round(rect.height)}`;
      }
    } catch (error) {
      // 拿不到布局信息就算了，描述里省略尺寸
    }
    return `<${tag}${id}>${size}`;
  }

  /**
   * 每帧结算：刷新动作快照并推进 just_pressed / just_released。
   *
   * 同一个引擎帧内被重复调用（例如自动帧循环之外又手动调了一次）不会推进边沿状态，
   * 避免把还没被游戏逻辑读到的 just_pressed / just_released 提前清掉。
   */
  static update(): void {
    if (!Input._installed) Input.install();
    Input._beginFrame();
    Input._pollJoypads();
    Input._evaluateActions();
  }

  /* ------------------------------------------------------------------ */
  /*                          动作（Action）                            */
  /* ------------------------------------------------------------------ */

  /**
   * 动作当前是否被按下。等价于 `Input.is_action_pressed()`。
   * @param allowEcho 预留给键盘连发场景。本移植中按键保持“按下”状态直到抬起，
   *                  因此该参数无需特殊处理。
   */
  static isActionPressed(action: string, exactMatch: boolean = false, allowEcho: boolean = false): boolean {
    Input.install();
    Input._syncInputMap();
    Input._warnIfActionMissing(action);
    if (exactMatch) return Input._evaluateAction(action, true).pressed;
    const state = Input._actionStates.get(action);
    if (!state) return false;
    void allowEcho;
    return state.pressed;
  }

  /**
   * 动作是否在本帧刚被按下。等价于 `Input.is_action_just_pressed()`。
   *
   * 具体语义：
   * - 按键 / 鼠标 / 手柄按键在下落的那一刻就算数，不需要等到下一次 `Input.update()`，
   *   所以在事件所在的这一帧里查询一定能拿到 `true`；
   * - 同一帧内查询多少次结果都一样，且每个边沿只会“上报”一帧，不会重复触发；
   * - 如果某一帧里游戏逻辑完全没查过（例如这一帧没有跑任何脚本），边沿会保留到下一帧
   *   补读一次，避免掉帧或时序错位导致按键被吞掉；
   * - 同一帧内按下再抬起（快速点击）同样会被识别为 `just_pressed`。
   */
  static isActionJustPressed(action: string, exactMatch: boolean = false): boolean {
    Input._prepareEdgeQuery();
    Input._warnIfActionMissing(action);
    return exactMatch
      ? Input._readEdge(action, Input._freshExactDown, Input._carryExactDown, Input._readExactDown)
      : Input._readEdge(action, Input._freshDown, Input._carryDown, Input._readDown);
  }

  /** 动作是否在本帧刚被抬起。等价于 `Input.is_action_just_released()`，语义同 `isActionJustPressed()`。 */
  static isActionJustReleased(action: string, exactMatch: boolean = false): boolean {
    Input._prepareEdgeQuery();
    Input._warnIfActionMissing(action);
    return exactMatch
      ? Input._readEdge(action, Input._freshExactUp, Input._carryExactUp, Input._readExactUp)
      : Input._readEdge(action, Input._freshUp, Input._carryUp, Input._readUp);
  }

  /**
   * 读取边沿前的准备工作：安装监听（自愈）+ 按引擎帧推进输入帧。
   *
   * 这里的推进是「惰性」的：只要引擎时钟动过就推进一次，
   * 因此**即使没有人调用 `Input.update()`**（比如帧循环没装上、或者你只在 `onUpdate` 里轮询），
   * `just_pressed` / `just_released` 依然会正常结算，不会一直卡在 `true`。
   */
  private static _prepareEdgeQuery(): void {
    Input.install();
    Input._syncFrame();
    Input._syncInputMap();
  }

  /** 指定事件是否会让动作“刚被按下”。等价于 `Input.is_action_just_pressed_by_event()`。 */
  static isActionJustPressedByEvent(action: string, event: InputEvent, exactMatch: boolean = false): boolean {
    if (!event || !event.isPressed()) return false;
    return InputMap.singleton.eventIsAction(event, action, exactMatch);
  }

  /** 指定事件是否会让动作“刚被抬起”。等价于 `Input.is_action_just_released_by_event()`。 */
  static isActionJustReleasedByEvent(action: string, event: InputEvent, exactMatch: boolean = false): boolean {
    if (!event || event.isPressed()) return false;
    return InputMap.singleton.eventIsAction(event, action, exactMatch);
  }

  /** 动作强度（已应用死区并归一化，0 ~ 1）。等价于 `Input.get_action_strength()`。 */
  static getActionStrength(action: string, exactMatch: boolean = false): number {
    Input.install();
    Input._syncInputMap();
    Input._warnIfActionMissing(action);
    if (exactMatch) return Input._evaluateAction(action, true).strength;
    const state = Input._actionStates.get(action);
    if (!state) return 0;
    return state.strength;
  }

  /** 动作原始强度（未归一化）。等价于 `Input.get_action_raw_strength()`。 */
  static getActionRawStrength(action: string, exactMatch: boolean = false): number {
    Input.install();
    Input._syncInputMap();
    Input._warnIfActionMissing(action);
    if (exactMatch) return Input._evaluateAction(action, true).rawStrength;
    const state = Input._actionStates.get(action);
    if (!state) return 0;
    return state.rawStrength;
  }

  /** 已经提示过的缺失动作，避免每帧刷屏。 */
  private static _warnedMissingActions: Set<string> = new Set();

  /**
   * 动作不存在时给出明确提示（等价于 Godot 的报错行为），同一个动作只提示一次。
   *
   * 绝大多数「怎么按键都读不到」的情况，其实是这里：动作名写错、
   * 或者 `InputMap` 的映射表还没加载（`loadFromFile()` 没 await、路径 404 等）。
   */
  private static _warnIfActionMissing(action: string): void {
    if (!action || InputMap.singleton.hasAction(action)) return;
    if (Input._warnedMissingActions.has(action)) return;
    Input._warnedMissingActions.add(action);
    console.warn(
      `[Input] 动作 "${action}" 不存在，查询永远是 false。` +
        `请检查动作名，或确认 InputMap 的映射表已加载（loadFromFile / addAction / loadFromJSON）。`
    );
  }

  /** 一维轴值，正向减负向。等价于 `Input.get_axis()`。 */
  static getAxis(negativeAction: string, positiveAction: string): number {
    return Input.getActionStrength(positiveAction) - Input.getActionStrength(negativeAction);
  }

  /**
   * 二维向量。等价于 `Input.get_vector()`。
   * @param deadzone 传入负数（默认）时自动取四个动作死区的平均值。
   */
  static getVector(
    negativeX: string,
    positiveX: string,
    negativeY: string,
    positiveY: string,
    deadzone: number = -1
  ): Vec2 {
    Input.install();
    let x = Input.getActionRawStrength(positiveX) - Input.getActionRawStrength(negativeX);
    let y = Input.getActionRawStrength(positiveY) - Input.getActionRawStrength(negativeY);
    let length = Math.sqrt(x * x + y * y);
    if (length <= 0) return vec2();

    if (length > 1) {
      x /= length;
      y /= length;
      length = 1;
    }

    const map = InputMap.singleton;
    const useDefaultDeadzone = !Number.isFinite(deadzone) || deadzone < 0;
    const dz =
      useDefaultDeadzone
        ? (map.actionGetDeadzone(negativeX) +
            map.actionGetDeadzone(positiveX) +
            map.actionGetDeadzone(negativeY) +
            map.actionGetDeadzone(positiveY)) /
          4
        : Math.min(Math.max(deadzone, 0), 1);

    if (length <= dz || dz >= 1) return vec2();
    const newLength = Math.min(Math.max((length - dz) / (1 - dz), 0), 1);
    const scale = newLength / length;
    return vec2(x * scale, y * scale);
  }

  /** 强制按下某个动作。等价于 `Input.action_press()`。 */
  static actionPress(action: string, strength: number = 1): void {
    Input.install();
    InputMap.singleton.setForcedAction(action, true, strength);
    // 立即结算，让 isActionPressed / isActionJustPressed 在同一个调用栈内就是一致的。
    Input._recordActionState(action, Input._evaluateAction(action));
    Input._inputMapRevision = InputMap.singleton.revision;
  }

  /** 强制抬起某个动作。等价于 `Input.action_release()`。 */
  static actionRelease(action: string): void {
    Input.install();
    InputMap.singleton.setForcedAction(action, false, 0);
    Input._recordActionState(action, Input._evaluateAction(action));
    Input._inputMapRevision = InputMap.singleton.revision;
  }

  /** 用代码设置一维轴值。等价于 `Input.set_axis()`。 */
  static setAxis(negativeAction: string, positiveAction: string, axisValue: number): void {
    Input.install();
    if (axisValue < 0) {
      Input.actionPress(negativeAction, -axisValue);
      Input.actionRelease(positiveAction);
    } else if (axisValue > 0) {
      Input.actionPress(positiveAction, axisValue);
      Input.actionRelease(negativeAction);
    } else {
      Input.actionRelease(negativeAction);
      Input.actionRelease(positiveAction);
    }
  }

  /** 清空所有按键 / 鼠标 / 手柄 / 虚拟动作状态。等价于 `Input.release_all_inputs()`。 */
  static releaseAllInputs(): void {
    Input._pressedKeys.clear();
    Input._pressedPhysicalKeys.clear();
    Input._pressedKeyLabels.clear();
    Input._pressedMouseButtons.clear();
    Input._mouseButtonMask = 0;
    Input._injectedJoyButtons.clear();
    Input._injectedJoyAxes.clear();
    InputMap.singleton.clearForcedActions();
    for (const joypad of Input._joypads.values()) {
      joypad.buttons.fill(false);
      joypad.axes.fill(0);
    }
    Input._actionStates.clear();
    Input._clearEdges();
    Input._warnedMissingActions.clear();
    Input._inputMapRevision = InputMap.singleton.revision;
  }

  /* ------------------------------------------------------------------ */
  /*                            键盘                                  */
  /* ------------------------------------------------------------------ */

  /** 逻辑按键是否按下。等价于 `Input.is_key_pressed()`。 */
  static isKeyPressed(keycode: Key): boolean {
    Input.install();
    return Input._pressedKeys.has(keycode);
  }

  /** 物理按键是否按下。等价于 `Input.is_physical_key_pressed()`。 */
  static isPhysicalKeyPressed(keycode: Key): boolean {
    Input.install();
    return Input._pressedPhysicalKeys.has(keycode);
  }

  /**
   * 是否有任意输入被按下（键盘 / 鼠标 / 手柄 / 动作）。
   * 等价于 `Input.is_anything_pressed()`。
   */
  static isAnythingPressed(): boolean {
    Input.install();
    Input._syncInputMap();
    if (Input._pressedKeys.size > 0) return true;
    if (Input._pressedPhysicalKeys.size > 0) return true;
    if (Input._pressedKeyLabels.size > 0) return true;
    if (Input._pressedMouseButtons.size > 0) return true;

    for (const joypad of Input._joypads.values()) {
      if (!joypad.connected) continue;
      for (const pressed of joypad.buttons) {
        if (pressed) return true;
      }
      for (const value of joypad.axes) {
        if (Math.abs(value) > 0.5) return true;
      }
    }
    for (const buttons of Input._injectedJoyButtons.values()) {
      if (buttons.size > 0) return true;
    }
    for (const axes of Input._injectedJoyAxes.values()) {
      for (const value of axes.values()) {
        if (Math.abs(value) > 0.5) return true;
      }
    }
    for (const state of Input._actionStates.values()) {
      if (state.pressed) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /*                            鼠标                                  */
  /* ------------------------------------------------------------------ */

  /** 鼠标按键是否按下。等价于 `Input.is_mouse_button_pressed()`。 */
  static isMouseButtonPressed(button: MouseButton): boolean {
    Input.install();
    return Input._pressedMouseButtons.has(button);
  }

  /** 鼠标按键掩码。等价于 `Input.get_mouse_button_mask()`。 */
  static getMouseButtonMask(): number {
    Input.install();
    return Input._mouseButtonMask;
  }

  /** 鼠标在舞台坐标系中的位置。等价于 `Input.get_mouse_position()`。 */
  static getMousePosition(): Vec2 {
    Input.install();
    return vec2(Input._mousePosition.x, Input._mousePosition.y);
  }

  /** 鼠标在屏幕（画布）坐标系中的位置。等价于 `Input.get_mouse_screen_position()`。 */
  static getMouseScreenPosition(): Vec2 {
    Input.install();
    return Input.getMousePosition();
  }

  /** 上一帧的鼠标速度（像素 / 秒）。等价于 `Input.get_last_mouse_velocity()`。 */
  static getLastMouseVelocity(): Vec2 {
    return vec2(Input._mouseVelocity.x, Input._mouseVelocity.y);
  }

  /** 上一帧的鼠标屏幕速度。等价于 `Input.get_last_mouse_screen_velocity()`。 */
  static getLastMouseScreenVelocity(): Vec2 {
    return vec2(Input._mouseScreenVelocity.x, Input._mouseScreenVelocity.y);
  }

  /** 鼠标模式。等价于 `Input.get_mouse_mode()`。 */
  static getMouseMode(): MouseMode {
    return Input._mouseMode;
  }

  /** 设置鼠标模式。等价于 `Input.set_mouse_mode()`。 */
  static setMouseMode(mode: MouseMode): void {
    Input._mouseMode = mode;
    const doc: any = typeof document !== "undefined" ? document : null;
    if (mode === MouseMode.VISIBLE) {
      const canvas: any = doc ? doc.querySelector("canvas") : null;
      if (doc && canvas && doc.exitPointerLock && doc.pointerLockElement === canvas) doc.exitPointerLock();
    } else if (mode === MouseMode.CAPTURED) {
      const canvas: any = doc ? doc.querySelector("canvas") : null;
      if (canvas && canvas.requestPointerLock) canvas.requestPointerLock();
    }
    Input._applyCursor();
  }

  /** 把鼠标移动到指定位置（浏览器只能影响捕获模式下的逻辑位置）。 */
  static warpMouse(position: Vec2): void {
    Input._mousePosition = vec2(position.x, position.y);
    Input._lastMousePosition = vec2(position.x, position.y);
  }

  /** 设置默认光标形状。等价于 `Input.set_default_cursor_shape()`。 */
  static setDefaultCursorShape(shape: CursorShape = CursorShape.ARROW): void {
    Input._cursorShape = shape;
    Input._applyCursor();
  }

  /**
   * 设置自定义光标图片。等价于 `Input.set_custom_mouse_cursor()`。
   *
   * 浏览器只能通过 CSS `cursor: url(...)` 实现，因此 `image` 需要是可直接
   * 被浏览器加载的 URL（data URL、blob URL 或站点内的图片地址）。
   * 传入 `null` 表示清除该形状的自定义光标，恢复默认形状。
   */
  static setCustomMouseCursor(image: any, shape: CursorShape = CursorShape.ARROW, hotspot: Vec2 = { x: 0, y: 0 }): void {
    const url = typeof image === "string" ? image : image && image.url ? image.url : "";
    if (!url) {
      Input._customCursors.delete(shape);
    } else {
      const x = Math.round(hotspot ? hotspot.x : 0);
      const y = Math.round(hotspot ? hotspot.y : 0);
      Input._customCursors.set(shape, `url("${url}") ${x} ${y}, auto`);
    }
    Input._applyCursor();
  }

  /** 读取当前光标形状。等价于 `Input.get_current_cursor_shape()`。 */
  static getCurrentCursorShape(): CursorShape {
    return Input._cursorShape;
  }

  /** 把当前鼠标模式与光标形状应用到画布上。 */
  private static _applyCursor(): void {
    const doc: any = typeof document !== "undefined" ? document : null;
    const canvas: any = doc ? doc.querySelector("canvas") : null;
    if (!canvas) return;

    if (Input._mouseMode !== MouseMode.VISIBLE && Input._mouseMode !== MouseMode.CONFINED) {
      // HIDDEN / CAPTURED / CONFINED_HIDDEN 一律隐藏系统光标。
      canvas.style.cursor = "none";
      return;
    }
    const custom = Input._customCursors.get(Input._cursorShape);
    canvas.style.cursor = custom || cursorShapeToCss(Input._cursorShape);
  }

  /** 是否将触摸模拟为鼠标。等价于 `Input.is_emulating_mouse_from_touch()`。 */
  static isEmulatingMouseFromTouch(): boolean {
    return Input._emulateMouseFromTouch;
  }

  /** 设置是否将触摸模拟为鼠标。 */
  static setEmulateMouseFromTouch(enable: boolean): void {
    Input._emulateMouseFromTouch = enable;
  }

  /** 是否将鼠标模拟为触摸。等价于 `Input.is_emulating_touch_from_mouse()`。 */
  static isEmulatingTouchFromMouse(): boolean {
    return Input._emulateTouchFromMouse;
  }

  /** 设置是否将鼠标模拟为触摸。 */
  static setEmulateTouchFromMouse(enable: boolean): void {
    Input._emulateTouchFromMouse = enable;
  }

  /**
   * 焦点落在**可见的** HTML 输入控件（`input` / `textarea` / `select` / `contenteditable`）上时，
   * 是否忽略键盘。默认 `true`，避免在输入框里打字时触发游戏输入。
   *
   * 隐藏的输入控件（引擎用来接收键盘 / 输入法事件的元素）不算，不会误伤游戏键盘。
   * 如果你的项目有自己的输入框需要特殊处理，可以关掉这个开关自行判断。
   */
  static isIgnoringKeysInTextInput(): boolean {
    return Input._ignoreKeysInTextInput;
  }

  /** 设置焦点在输入框里时是否忽略键盘。 */
  static setIgnoreKeysInTextInput(enable: boolean): void {
    Input._ignoreKeysInTextInput = enable;
  }

  /* ------------------------------------------------------------------ */
  /*                        事件派发 / 缓冲                            */
  /* ------------------------------------------------------------------ */

  /**
   * 手动派发一个输入事件（会让它参与动作匹配）。
   * 等价于 `Input.parse_input_event()`。
   */
  static parseInputEvent(event: InputEvent): void {
    if (!event) return;
    Input.install();
    Input._syncInputMap();
    Input._dispatchInputEvent(event, true);
  }

  /** 派发事件；引擎监听器已经更新过底层状态时可跳过重复写入。 */
  private static _dispatchInputEvent(event: InputEvent, updateState: boolean): void {
    if (
      Input._ignoringJoypad &&
      (event instanceof InputEventJoypadButton || event instanceof InputEventJoypadMotion)
    ) {
      return;
    }
    if (updateState) Input._applyInjectedEventState(event);
    Input._applyEvent(event);
    Input._inputMapRevision = InputMap.singleton.revision;
  }

  private static _applyInjectedEventState(event: InputEvent): void {
    if (event instanceof InputEventKey) {
      if (event.isPressed()) {
        if (event.keycode !== Key.NONE) Input._pressedKeys.add(event.keycode);
        if (event.physicalKeycode !== Key.NONE) Input._pressedPhysicalKeys.add(event.physicalKeycode);
        if (event.keyLabel !== Key.NONE) Input._pressedKeyLabels.add(event.keyLabel);
      } else {
        if (event.keycode !== Key.NONE) Input._pressedKeys.delete(event.keycode);
        if (event.physicalKeycode !== Key.NONE) Input._pressedPhysicalKeys.delete(event.physicalKeycode);
        if (event.keyLabel !== Key.NONE) Input._pressedKeyLabels.delete(event.keyLabel);
      }
      return;
    }
    if (event instanceof InputEventMouseButton) {
      if (event.buttonIndex === MouseButton.NONE) return;
      if (event.isPressed()) {
        Input._pressedMouseButtons.add(event.buttonIndex);
        Input._mouseButtonMask |= Input._toButtonMask(event.buttonIndex);
      } else {
        Input._pressedMouseButtons.delete(event.buttonIndex);
        Input._mouseButtonMask &= ~Input._toButtonMask(event.buttonIndex);
      }
      return;
    }
    if (event instanceof InputEventJoypadButton) {
      const buttons = Input._injectedJoyButtons.get(event.device) ?? new Set<JoyButton>();
      if (event.isPressed()) buttons.add(event.buttonIndex);
      else buttons.delete(event.buttonIndex);
      if (buttons.size > 0) Input._injectedJoyButtons.set(event.device, buttons);
      else Input._injectedJoyButtons.delete(event.device);
      return;
    }
    if (event instanceof InputEventJoypadMotion) {
      const axes = Input._injectedJoyAxes.get(event.device) ?? new Map<JoyAxis, number>();
      if (event.axisValue === 0) axes.delete(event.axis);
      else axes.set(event.axis, event.axisValue);
      if (axes.size > 0) Input._injectedJoyAxes.set(event.device, axes);
      else Input._injectedJoyAxes.delete(event.device);
      return;
    }
    if (event instanceof InputEventAction && event.action) {
      InputMap.singleton.setForcedAction(event.action, event.isPressed(), event.strength);
    }
  }

  /** 兼容 Godot API；本实现会即时处理事件，因此没有待清空的事件队列。 */
  static flushBufferedEvents(): void {
    // 事件在 parseInputEvent() 中即时生效。
  }

  /** 是否使用累积输入。等价于 `Input.is_using_accumulated_input()`。 */
  static isUsingAccumulatedInput(): boolean {
    return Input._useAccumulatedInput;
  }

  /** 设置是否使用累积输入。 */
  static setUseAccumulatedInput(enable: boolean): void {
    Input._useAccumulatedInput = enable;
  }

  /* ------------------------------------------------------------------ */
  /*                            手柄                                  */
  /* ------------------------------------------------------------------ */

  /** 已连接的手柄设备 ID 列表。等价于 `Input.get_connected_joypads()`。 */
  static getConnectedJoypads(): number[] {
    Input.install();
    const result: number[] = [];
    for (const joypad of Input._joypads.values()) {
      if (joypad.connected) result.push(joypad.index);
    }
    return result;
  }

  /** 手柄名称。等价于 `Input.get_joy_name()`。 */
  static getJoyName(device: number): string {
    return Input._joypads.get(device)?.name ?? "";
  }

  /** 手柄 GUID。等价于 `Input.get_joy_guid()`。 */
  static getJoyGuid(device: number): string {
    return Input._joypads.get(device)?.guid ?? "";
  }

  /** 手柄信息字典。等价于 `Input.get_joy_info()`。 */
  static getJoyInfo(device: number): Record<string, any> {
    const joypad = Input._joypads.get(device);
    if (!joypad) return {};
    return {
      name: joypad.name,
      guid: joypad.guid,
      raw_name: joypad.name,
      vendor_id: 0,
      product_id: 0,
    };
  }

  /** 手柄按键是否按下。等价于 `Input.is_joy_button_pressed()`。 */
  static isJoyButtonPressed(device: number, button: JoyButton): boolean {
    Input.install();
    if (Input._ignoringJoypad) return false;
    const joypad = Input._joypads.get(device);
    return (
      (joypad?.connected === true && joypad.buttons[button] === true) ||
      Input._injectedJoyButtons.get(device)?.has(button) === true
    );
  }

  /** 手柄轴值。等价于 `Input.get_joy_axis()`。 */
  static getJoyAxis(device: number, axis: JoyAxis): number {
    Input.install();
    if (Input._ignoringJoypad) return 0;
    const injected = Input._injectedJoyAxes.get(device)?.get(axis);
    if (injected !== undefined) return injected;
    const joypad = Input._joypads.get(device);
    return joypad?.connected === true ? (joypad.axes[axis] ?? 0) : 0;
  }

  /** 轴名 -> `JoyAxis`。等价于 `Input.get_joy_axis_index_from_string()`。 */
  static getJoyAxisIndexFromString(axis: string): JoyAxis {
    return joyAxisFromString(axis);
  }

  /** `JoyAxis` -> 轴名。等价于 `Input.get_joy_axis_string()`。 */
  static getJoyAxisString(axisIndex: JoyAxis): string {
    return joyAxisToString(axisIndex);
  }

  /** 按键名 -> `JoyButton`。等价于 `Input.get_joy_button_index_from_string()`。 */
  static getJoyButtonIndexFromString(button: string): JoyButton {
    return joyButtonFromString(button);
  }

  /** `JoyButton` -> 按键名。等价于 `Input.get_joy_button_string()`。 */
  static getJoyButtonString(buttonIndex: JoyButton): string {
    return joyButtonToString(buttonIndex);
  }

  /** 手柄是否被识别（已连接即视为已知）。等价于 `Input.is_joy_known()`。 */
  static isJoyKnown(device: number): boolean {
    return !!Input._joypads.get(device)?.connected;
  }

  /** 手柄是否支持震动。等价于 `Input.has_joy_vibration()`。 */
  static hasJoyVibration(device: number): boolean {
    const gamepad = Input._getRawGamepad(device);
    return !!(gamepad && gamepad.vibrationActuator);
  }

  /** 手柄是否支持震动（Godot 旧名）。等价于 `Input.is_joy_vibration_supported()`。 */
  static isJoyVibrationSupported(device: number): boolean {
    return Input.hasJoyVibration(device);
  }

  /** 手柄当前是否正在震动。等价于 `Input.is_joy_vibrating()`。 */
  static isJoyVibrating(device: number): boolean {
    const info = Input._joyVibrations.get(device);
    if (!info || info.endTime <= 0) return false;
    return Input._now() < info.endTime;
  }

  /** 手柄震动的总时长（毫秒）。等价于 `Input.get_joy_vibration_duration()`。 */
  static getJoyVibrationDuration(device: number): number {
    return Input._joyVibrations.get(device)?.duration ?? 0;
  }

  /** 手柄震动的剩余时长（毫秒）。等价于 `Input.get_joy_vibration_remaining_duration()`。 */
  static getJoyVibrationRemainingDuration(device: number): number {
    const info = Input._joyVibrations.get(device);
    if (!info || info.endTime <= 0) return 0;
    return Math.max(info.endTime - Input._now(), 0);
  }

  /** 手柄震动的弱/强马达强度。等价于 `Input.get_joy_vibration_strength()`。 */
  static getJoyVibrationStrength(device: number): Vec2 {
    const info = Input._joyVibrations.get(device);
    return vec2(info ? info.weak : 0, info ? info.strong : 0);
  }

  /**
   * 开始手柄震动。等价于 `Input.start_joy_vibration()`。
   * @param duration 时长，单位为**秒**（与 Godot 一致）。
   */
  static startJoyVibration(device: number, weakMagnitude: number, strongMagnitude: number, duration: number = 0): void {
    const durationMs = duration > 0 ? duration * 1000 : 0;
    Input._joyVibrations.set(device, {
      weak: weakMagnitude,
      strong: strongMagnitude,
      duration: durationMs,
      endTime: durationMs > 0 ? Input._now() + durationMs : 0,
    });

    const gamepad = Input._getRawGamepad(device);
    if (!gamepad || !gamepad.vibrationActuator) return;
    gamepad.vibrationActuator.playEffect("dual-rumble", {
      duration: durationMs,
      weakMagnitude,
      strongMagnitude,
      startDelay: 0,
    });
  }

  /** 停止手柄震动。等价于 `Input.stop_joy_vibration()`。 */
  static stopJoyVibration(device: number): void {
    Input._joyVibrations.delete(device);
    const gamepad = Input._getRawGamepad(device);
    if (!gamepad || !gamepad.vibrationActuator) return;
    gamepad.vibrationActuator.reset();
  }

  /**
   * 移动端整体震动。等价于 `Input.vibrate_handheld()`。
   * @param amplitude 浏览器 Vibration API 不支持单独指定振幅，该参数会被忽略。
   */
  static vibrateHandheld(durationMs: number = 500, amplitude: number = -1): void {
    void amplitude;
    const nav: any = typeof navigator !== "undefined" ? navigator : null;
    if (nav && typeof nav.vibrate === "function") nav.vibrate(durationMs);
  }

  /**
   * 注册一个 SDL 风格的手柄映射字符串。等价于 `Input.add_joy_mapping()`。
   *
   * 浏览器不允许替换手柄映射，这里只做记录，`getJoyGuid()` / `getConnectedJoypads()`
   * 依旧反映真实的 Gamepad 状态。
   */
  static addJoyMapping(mapping: string, updateExisting: boolean = false): void {
    if (!mapping) return;
    const guid = String(mapping).split(",")[0];
    if (!guid) return;
    if (!updateExisting && Input._joyMappings.has(guid)) return;
    Input._joyMappings.set(guid, mapping);
  }

  /** 移除一个手柄映射。等价于 `Input.remove_joy_mapping()`。 */
  static removeJoyMapping(guid: string): void {
    Input._joyMappings.delete(guid);
  }

  /** 已注册的手柄映射字符串。 */
  static getJoyMappings(): string[] {
    return Array.from(Input._joyMappings.values());
  }

  /** 手柄是否带灯。等价于 `Input.has_joy_light()`；浏览器不暴露该能力，固定返回 false。 */
  static hasJoyLight(device: number): boolean {
    void device;
    return false;
  }

  /** 设置手柄灯颜色。等价于 `Input.set_joy_light()`；浏览器不暴露该能力，无副作用。 */
  static setJoyLight(device: number, color: any): void {
    void device;
    void color;
  }

  /**
   * 判断某个厂商/产品 ID 的手柄是否应被忽略。
   * 等价于 `Input.should_ignore_device()`，此处固定返回 false（不忽略任何设备）。
   */
  static shouldIgnoreDevice(vendorId: number, productId: number): boolean {
    void vendorId;
    void productId;
    return false;
  }

  /** 是否忽略手柄输入（Godot 4.2 及以前的 `ignoring_joypad`）。 */
  static isIgnoringJoypad(): boolean {
    return Input._ignoringJoypad;
  }

  /** 设置是否忽略手柄输入。 */
  static setIgnoringJoypad(enable: boolean): void {
    if (Input._ignoringJoypad === enable) return;
    Input._ignoringJoypad = enable;
    if (enable) {
      Input._clearJoypadInputState();
      Input._evaluateActions();
    }
  }

  /** 窗口失焦时是否忽略手柄（Godot 4.3+ 的 `ignore_joypad_on_unfocused`）。 */
  static isIgnoreJoypadOnUnfocused(): boolean {
    return Input._ignoreJoypadOnUnfocused;
  }

  /** 设置窗口失焦时是否忽略手柄。 */
  static setIgnoreJoypadOnUnfocused(enable: boolean): void {
    Input._ignoreJoypadOnUnfocused = enable;
  }

  /** 监听手柄连接状态变化。等价于 Godot 的 `joy_connection_changed` 信号。 */
  static onJoyConnectionChanged(callback: JoyConnectionChangedCallback): void {
    if (Input._joyConnectionListeners.indexOf(callback) < 0) Input._joyConnectionListeners.push(callback);
  }

  /** 取消监听手柄连接状态变化。 */
  static offJoyConnectionChanged(callback: JoyConnectionChangedCallback): void {
    const index = Input._joyConnectionListeners.indexOf(callback);
    if (index >= 0) Input._joyConnectionListeners.splice(index, 1);
  }

  /* ------------------------------------------------------------------ */
  /*                          设备传感器                                */
  /* ------------------------------------------------------------------ */

  /** 重力向量（m/s²）。等价于 `Input.get_gravity()`。 */
  static getGravity(): Vec3 {
    return deviceSensors.getGravity();
  }

  /** 加速度计向量。等价于 `Input.get_accelerometer()`。 */
  static getAccelerometer(): Vec3 {
    return deviceSensors.getAccelerometer();
  }

  /** 磁力计向量。等价于 `Input.get_magnetometer()`。 */
  static getMagnetometer(): Vec3 {
    return deviceSensors.getMagnetometer();
  }

  /** 陀螺仪向量。等价于 `Input.get_gyroscope()`。 */
  static getGyroscope(): Vec3 {
    return deviceSensors.getGyroscope();
  }

  /** 设备朝向四元数。等价于 `Input.get_device_orientation()`。 */
  static getDeviceOrientation(): Quat {
    return deviceSensors.getOrientation();
  }

  /** 覆盖设备朝向（例如自己接入了原生传感器）。等价于 `Input.set_device_orientation()`。 */
  static setDeviceOrientation(orientation: Quat): void {
    deviceSensors.setOrientation(orientation);
  }

  /** 覆盖重力向量。等价于 `Input.set_gravity()`。 */
  static setGravity(value: Vec3): void {
    deviceSensors.setGravity(value);
  }

  /** 覆盖加速度计向量。等价于 `Input.set_accelerometer()`。 */
  static setAccelerometer(value: Vec3): void {
    deviceSensors.setAccelerometer(value);
  }

  /** 覆盖陀螺仪向量。等价于 `Input.set_gyroscope()`。 */
  static setGyroscope(value: Vec3): void {
    deviceSensors.setGyroscope(value);
  }

  /** 覆盖磁力计向量。等价于 `Input.set_magnetometer()`。 */
  static setMagnetometer(value: Vec3): void {
    deviceSensors.setMagnetometer(value);
  }

  /* ---- 浏览器无法实现的手柄硬件接口（保留同名方法以便移植代码可编译运行） ---- */

  /**
   * 手柄是否带运动传感器。等价于 `Input.has_joy_motion_sensors()`。
   * Web Gamepad API 不暴露该能力，固定返回 false。
   */
  static hasJoyMotionSensors(device: number): boolean {
    void device;
    return false;
  }

  /** 手柄重力向量。等价于 `Input.get_joy_gravity()`；Web 端固定返回零向量。 */
  static getJoyGravity(device: number): Vec3 {
    void device;
    return vec3();
  }

  /** 手柄加速度计向量。等价于 `Input.get_joy_accelerometer()`；Web 端固定返回零向量。 */
  static getJoyAccelerometer(device: number): Vec3 {
    void device;
    return vec3();
  }

  /** 手柄陀螺仪向量。等价于 `Input.get_joy_gyroscope()`；Web 端固定返回零向量。 */
  static getJoyGyroscope(device: number): Vec3 {
    void device;
    return vec3();
  }

  /** 手柄触摸板数量。等价于 `Input.get_joy_touchpad_count()`；Web 端固定返回 0。 */
  static getJoyTouchpadCount(device: number): number {
    void device;
    return 0;
  }

  /** 手柄触摸板上的触点。等价于 `Input.get_joy_touchpad_fingers()`；Web 端固定返回空数组。 */
  static getJoyTouchpadFingers(device: number, touchpad: number): number[] {
    void device;
    void touchpad;
    return [];
  }

  /** 手柄触摸板触点位置。等价于 `Input.get_joy_touchpad_finger_position()`。 */
  static getJoyTouchpadFingerPosition(device: number, touchpad: number, finger: number): Vec2 {
    void device;
    void touchpad;
    void finger;
    return vec2();
  }

  /** 手柄触摸板触点压力。等价于 `Input.get_joy_touchpad_finger_pressure()`。 */
  static getJoyTouchpadFingerPressure(device: number, touchpad: number, finger: number): number {
    void device;
    void touchpad;
    void finger;
    return 0;
  }

  /* ---- 手柄运动传感器标定（Web 端无对应能力，均为空实现） ---- */

  /** 等价于 `Input.is_joy_motion_sensors_enabled()`。 */
  static isJoyMotionSensorsEnabled(device: number): boolean {
    void device;
    return false;
  }

  /** 等价于 `Input.set_joy_motion_sensors_enabled()`。 */
  static setJoyMotionSensorsEnabled(device: number, enable: boolean): void {
    void device;
    void enable;
  }

  /** 等价于 `Input.is_joy_motion_sensors_calibrated()`。 */
  static isJoyMotionSensorsCalibrated(device: number): boolean {
    void device;
    return false;
  }

  /** 等价于 `Input.is_joy_motion_sensors_calibrating()`。 */
  static isJoyMotionSensorsCalibrating(device: number): boolean {
    void device;
    return false;
  }

  /** 等价于 `Input.is_joy_motion_sensors_auto_calibration_enabled()`。 */
  static isJoyMotionSensorsAutoCalibrationEnabled(device: number): boolean {
    void device;
    return false;
  }

  /** 等价于 `Input.set_joy_motion_sensors_auto_calibration_enabled()`。 */
  static setJoyMotionSensorsAutoCalibrationEnabled(device: number, enable: boolean): void {
    void device;
    void enable;
  }

  /** 等价于 `Input.get_joy_motion_sensors_rate()`。 */
  static getJoyMotionSensorsRate(device: number): number {
    void device;
    return 0;
  }

  /** 等价于 `Input.get_joy_motion_sensors_calibration()`。 */
  static getJoyMotionSensorsCalibration(device: number): Record<string, any> {
    void device;
    return {};
  }

  /** 等价于 `Input.set_joy_motion_sensors_calibration()`。 */
  static setJoyMotionSensorsCalibration(device: number, calibration: Record<string, any>): void {
    void device;
    void calibration;
  }

  /** 等价于 `Input.start_joy_motion_sensors_calibration()`。 */
  static startJoyMotionSensorsCalibration(device: number): void {
    void device;
  }

  /** 等价于 `Input.stop_joy_motion_sensors_calibration()`。 */
  static stopJoyMotionSensorsCalibration(device: number): void {
    void device;
  }

  /** 等价于 `Input.clear_joy_motion_sensors_calibration()`。 */
  static clearJoyMotionSensorsCalibration(device: number): void {
    void device;
  }

  /* ------------------------------------------------------------------ */
  /*                             输入法                                 */
  /* ------------------------------------------------------------------ */

  /** 读取 IME 文本。等价于 `Input.get_ime_text()`。 */
  static getImeText(): string {
    return Input._imeText;
  }

  /** 设置 IME 文本。等价于 `Input.set_ime_text()`。 */
  static setImeText(text: string): void {
    Input._imeText = text;
  }

  /* ------------------------------------------------------------------ */
  /*                        以下为内部实现                              */
  /* ------------------------------------------------------------------ */

  /**
   * 焦点是否落在「用户真的在用的」HTML 输入控件上；是的话不应把按键当成游戏输入。
   *
   * 注意不能只看 `tagName`：引擎自己会在页面里放一个**隐藏的 input/textarea**
   * 来接收键盘与输入法事件（LayaAir 的 `TextInput` 就是这么做的），
   * 它同样会成为 `document.activeElement`。如果把它也当成「正在打字」，
   * 游戏的键盘就会被全部忽略，表现为 `isActionPressed` 永远是 false。
   * 因此这里额外要求元素真的可见、有尺寸、位于视口内。
   */
  private static _isTextInputFocused(): boolean {
    if (!Input._ignoreKeysInTextInput) return false;
    if (typeof document === "undefined") return false;
    const active: any = document.activeElement;
    if (!active) return false;
    if (active === document.body || active === document.documentElement) return false;
    const tag = String(active.tagName || "").toLowerCase();
    const editable = tag === "input" || tag === "textarea" || tag === "select" || active.isContentEditable === true;
    if (!editable) return false;
    return Input._isElementVisible(active);
  }

  /** 元素是否真的显示在屏幕上（隐藏、零尺寸、跑到视口外的都算不可见）。 */
  private static _isElementVisible(element: any): boolean {
    const win: any = typeof window !== "undefined" ? window : null;
    try {
      if (typeof element.getBoundingClientRect === "function") {
        const rect = element.getBoundingClientRect();
        if (!rect || rect.width <= 1 || rect.height <= 1) return false;
        if (win) {
          if (rect.right <= 0 || rect.bottom <= 0) return false;
          if (win.innerWidth > 0 && rect.left >= win.innerWidth) return false;
          if (win.innerHeight > 0 && rect.top >= win.innerHeight) return false;
        }
      }
      if (win && typeof win.getComputedStyle === "function") {
        const style = win.getComputedStyle(element);
        if (style) {
          if (style.visibility === "hidden" || style.display === "none") return false;
          if (parseFloat(style.opacity || "1") === 0) return false;
        }
      }
    } catch (error) {
      // 拿不到布局信息时保守处理：认为它不可见，宁可让游戏收到按键。
      return false;
    }
    return true;
  }

  /** 键盘按下。 */
  private static onDomKeyDown(e: KeyboardEvent): void {
    Input._handleKeyDown(e);
  }

  /** 键盘抬起。 */
  private static onDomKeyUp(e: KeyboardEvent): void {
    Input._handleKeyUp(e);
  }

  /** Laya Stage 键盘按下。 */
  private static onStageKeyDown(e: Laya.Event): void {
    Input._handleKeyDown(Input._keyboardEventFromStage(e), true);
  }

  /** Laya Stage 键盘抬起。 */
  private static onStageKeyUp(e: Laya.Event): void {
    Input._handleKeyUp(Input._keyboardEventFromStage(e), true);
  }

  /**
   * 从 Laya.Event 读取键盘数据。Web 端优先使用原始 KeyboardEvent；
   * Native 端没有原始 DOM 事件时，Laya.Event 自己的 key / 修饰键仍可用。
   */
  private static _keyboardEventFromStage(e: Laya.Event): any {
    const stageEvent: any = e;
    const nativeEvent: any = stageEvent && stageEvent.nativeEvent;
    return {
      key: nativeEvent && typeof nativeEvent.key === "string" ? nativeEvent.key : stageEvent && stageEvent.key,
      code: nativeEvent && typeof nativeEvent.code === "string" ? nativeEvent.code : stageEvent && stageEvent.code,
      repeat: !!(nativeEvent && nativeEvent.repeat),
      altKey: !!((nativeEvent && nativeEvent.altKey) || (stageEvent && stageEvent.altKey)),
      shiftKey: !!((nativeEvent && nativeEvent.shiftKey) || (stageEvent && stageEvent.shiftKey)),
      ctrlKey: !!((nativeEvent && nativeEvent.ctrlKey) || (stageEvent && stageEvent.ctrlKey)),
      metaKey: !!((nativeEvent && nativeEvent.metaKey) || (stageEvent && stageEvent.metaKey)),
    };
  }

  private static _handleKeyDown(e: any, useLogicalAsPhysicalFallback: boolean = false): void {
    if (!Input._installed) return;
    if (Input._isTextInputFocused()) return;
    const logical = keyFromDomKey(typeof e.key === "string" ? e.key : "");
    const byCode = keyFromDomCode(typeof e.code === "string" ? e.code : "");
    const physical = byCode !== Key.NONE ? byCode : useLogicalAsPhysicalFallback ? logical : Key.NONE;
    if (logical !== Key.NONE) Input._pressedKeys.add(logical);
    if (physical !== Key.NONE) Input._pressedPhysicalKeys.add(physical);

    const event = new InputEventKey();
    event.keycode = logical;
    event.physicalKeycode = physical;
    event.keyLabel = logical;
    event.keyText = e.key && e.key.length === 1 ? e.key : "";
    event.unicode = event.keyText ? event.keyText.charCodeAt(0) : 0;
    event.pressed = true;
    event.echo = e.repeat;
    event.altPressed = e.altKey;
    event.shiftPressed = e.shiftKey;
    event.ctrlPressed = e.ctrlKey;
    event.metaPressed = e.metaKey;
    Input._dispatchInputEvent(event, true);
  }

  private static _handleKeyUp(e: any, useLogicalAsPhysicalFallback: boolean = false): void {
    if (!Input._installed) return;
    const logical = keyFromDomKey(typeof e.key === "string" ? e.key : "");
    const byCode = keyFromDomCode(typeof e.code === "string" ? e.code : "");
    const physical = byCode !== Key.NONE ? byCode : useLogicalAsPhysicalFallback ? logical : Key.NONE;
    if (logical !== Key.NONE) Input._pressedKeys.delete(logical);
    if (physical !== Key.NONE) Input._pressedPhysicalKeys.delete(physical);

    const event = new InputEventKey();
    event.keycode = logical;
    event.physicalKeycode = physical;
    event.keyLabel = logical;
    event.pressed = false;
    event.altPressed = e.altKey;
    event.shiftPressed = e.shiftKey;
    event.ctrlPressed = e.ctrlKey;
    event.metaPressed = e.metaKey;
    Input._dispatchInputEvent(event, true);
  }

  /** 窗口失焦时释放全部输入，避免“按键卡住”。 */
  private static onWindowBlur(): void {
    Input.releaseAllInputs();
  }

  /** 鼠标 / 触摸按下。 */
  private static onStageMouseDown(e: Laya.Event): void {
    if (!Input._installed) return;
    const button = Input._toMouseButton(e.button);
    Input._pressedMouseButtons.add(button);
    Input._mouseButtonMask |= Input._toButtonMask(button);

    const event = new InputEventMouseButton();
    event.buttonIndex = button;
    event.pressed = true;
    event.doubleClick = !!e.isDblClick;
    event.position = vec2(e.stageX, e.stageY);
    event.globalPosition = vec2(e.stageX, e.stageY);
    event.altPressed = e.altKey;
    event.shiftPressed = e.shiftKey;
    event.ctrlPressed = e.ctrlKey;
    event.metaPressed = e.metaKey;
    event.buttonMask = Input._mouseButtonMask;
    Input._mousePosition = vec2(e.stageX, e.stageY);
    Input._dispatchInputEvent(event, true);

    Input._emitTouchFromMouse(true, event.position);
  }

  /** 鼠标 / 触摸抬起。 */
  private static onStageMouseUp(e: Laya.Event): void {
    if (!Input._installed) return;
    const button = Input._toMouseButton(e.button);
    Input._pressedMouseButtons.delete(button);
    Input._mouseButtonMask &= ~Input._toButtonMask(button);

    const event = new InputEventMouseButton();
    event.buttonIndex = button;
    event.pressed = false;
    event.position = vec2(e.stageX, e.stageY);
    event.globalPosition = vec2(e.stageX, e.stageY);
    event.altPressed = e.altKey;
    event.shiftPressed = e.shiftKey;
    event.ctrlPressed = e.ctrlKey;
    event.metaPressed = e.metaKey;
    event.buttonMask = Input._mouseButtonMask;
    Input._mousePosition = vec2(e.stageX, e.stageY);
    Input._dispatchInputEvent(event, true);

    Input._emitTouchFromMouse(false, event.position);
  }

  /** 鼠标移动。 */
  private static onStageMouseMove(e: Laya.Event): void {
    if (!Input._installed) return;
    const position = vec2(e.stageX, e.stageY);
    const now = Date.now();
    const elapsed = Input._lastMouseTime > 0 ? Math.max(now - Input._lastMouseTime, 1) / 1000 : 0;
    const relative = Input._lastMousePosition
      ? vec2(position.x - Input._lastMousePosition.x, position.y - Input._lastMousePosition.y)
      : vec2();

    if (elapsed > 0) {
      Input._mouseVelocity = vec2(relative.x / elapsed, relative.y / elapsed);
      Input._mouseScreenVelocity = vec2(Input._mouseVelocity.x, Input._mouseVelocity.y);
    }
    Input._lastMousePosition = vec2(position.x, position.y);
    Input._lastMouseTime = now;
    Input._mousePosition = vec2(position.x, position.y);

    const event = new InputEventMouseMotion();
    event.position = vec2(position.x, position.y);
    event.globalPosition = vec2(position.x, position.y);
    event.relative = relative;
    event.velocity = vec2(Input._mouseVelocity.x, Input._mouseVelocity.y);
    event.buttonMask = Input._mouseButtonMask;
    event.altPressed = e.altKey;
    event.shiftPressed = e.shiftKey;
    event.ctrlPressed = e.ctrlKey;
    event.metaPressed = e.metaKey;
    Input._dispatchInputEvent(event, false);

    if (Input._pressedMouseButtons.has(MouseButton.LEFT)) {
      Input._emitTouchFromMouse(true, position, relative, true);
    }
  }

  /** 滚轮。 */
  private static onStageMouseWheel(e: Laya.Event): void {
    if (!Input._installed) return;
    const delta = e.delta || 0;
    const button = delta > 0 ? MouseButton.WHEEL_UP : MouseButton.WHEEL_DOWN;

    // Godot 中滚轮是一次“按下 + 抬起”的组合。
    const down = new InputEventMouseButton();
    down.buttonIndex = button;
    down.pressed = true;
    down.factor = Math.abs(delta) || 1;
    down.position = vec2(e.stageX, e.stageY);
    down.globalPosition = down.position;
    Input._dispatchInputEvent(down, true);

    const up = new InputEventMouseButton();
    up.buttonIndex = button;
    up.pressed = false;
    up.factor = down.factor;
    up.position = down.position;
    up.globalPosition = down.position;
    Input._dispatchInputEvent(up, true);
  }

  /** 把鼠标事件模拟为触摸事件。 */
  private static _emitTouchFromMouse(pressed: boolean, position: Vec2, relative?: Vec2, isDrag = false): void {
    if (!Input._emulateTouchFromMouse) return;
    if (isDrag) {
      const drag = new InputEventScreenDrag();
      drag.index = 0;
      drag.position = vec2(position.x, position.y);
      drag.relative = relative ? vec2(relative.x, relative.y) : vec2();
      drag.velocity = vec2(Input._mouseVelocity.x, Input._mouseVelocity.y);
      Input._dispatchInputEvent(drag, false);
      return;
    }
    const touch = new InputEventScreenTouch();
    touch.index = 0;
    touch.pressed = pressed;
    touch.position = vec2(position.x, position.y);
    Input._dispatchInputEvent(touch, false);
  }

  /** Laya 的 `Event.button` -> Godot `MouseButton`。 */
  private static _toMouseButton(button: number): MouseButton {
    switch (button) {
      case 0:
        return MouseButton.LEFT;
      case 1:
        return MouseButton.MIDDLE;
      case 2:
        return MouseButton.RIGHT;
      case 3:
        return MouseButton.XBUTTON1;
      case 4:
        return MouseButton.XBUTTON2;
      default:
        return MouseButton.NONE;
    }
  }

  /** Godot `MouseButton` -> Godot `MouseButtonMask`。 */
  private static _toButtonMask(button: MouseButton): number {
    switch (button) {
      case MouseButton.LEFT:
        return MouseButtonMask.LEFT;
      case MouseButton.RIGHT:
        return MouseButtonMask.RIGHT;
      case MouseButton.MIDDLE:
        return MouseButtonMask.MIDDLE;
      case MouseButton.XBUTTON1:
        return MouseButtonMask.MB_XBUTTON1;
      case MouseButton.XBUTTON2:
        return MouseButtonMask.MB_XBUTTON2;
      default:
        return 0;
    }
  }

  /** 事件落地：更新动作状态与边沿标记。 */
  private static _applyEvent(event: InputEvent): void {
    const map = InputMap.singleton;
    for (const action of map.getActions()) {
      const status = map.eventGetActionStatus(event, action, false);
      if (status.active) {
        const previousPressed = Input._actionStates.get(action)?.pressed ?? false;
        // 释放一个绑定时需要重新评估其他绑定，避免动作仍由另一个按键按住却被误报为释放。
        const result = status.pressed
          ? { pressed: true, strength: status.strength, rawStrength: status.rawStrength }
          : Input._evaluateAction(action);
        Input._recordActionState(action, result, false);

        const exactStatus = map.eventGetActionStatus(event, action, true);
        if (exactStatus.active && result.pressed !== previousPressed) {
          if (result.pressed) Input._freshExactDown.add(action);
          else Input._freshExactUp.add(action);
        }
        continue;
      }

      // 摇杆回到零位时方向和强度都不再匹配，但它仍然触及了同一条轴绑定。
      // 此时以所有绑定的当前真实状态为准重新计算动作。
      if (!Input._eventTouchesAction(event, action)) continue;
      Input._recordActionState(action, Input._evaluateAction(action));
    }
  }

  /** 事件是否与该动作的任意一条绑定相关（按下、抬起都算）。 */
  private static _eventTouchesAction(event: InputEvent, action: string): boolean {
    const map = InputMap.singleton;
    const deadzone = map.actionGetDeadzone(action);
    const out: ActionMatchResult = { pressed: false, strength: 0 };
    for (const rule of map.actionGetEvents(action)) {
      if (rule instanceof InputEventJoypadMotion && event instanceof InputEventJoypadMotion) {
        if (rule.axis === event.axis && (rule.device < 0 || rule.device === event.device)) return true;
      }
      out.pressed = false;
      out.strength = 0;
      if (rule.actionMatch(event, out, deadzone, false)) return true;
    }
    return false;
  }

  /**
   * 记录一次动作状态，并在按下 / 抬起的那一刻打上“刚按下 / 刚抬起”标记。
   *
   * 注意这里只在“状态真的翻转”时打标记，而且按下与抬起各自独立记录，
   * 所以同一帧内按下又抬起（快速点击）不会被互相覆盖掉。
   */
  private static _recordActionState(
    action: string,
    result: { pressed: boolean; strength: number; rawStrength: number },
    recordExactEdge: boolean = true
  ): void {
    const previous = Input._actionStates.get(action);
    const wasPressed = !!previous && previous.pressed;

    if (result.pressed && !wasPressed) {
      Input._freshDown.add(action);
      if (recordExactEdge) Input._freshExactDown.add(action);
    } else if (!result.pressed && wasPressed) {
      Input._freshUp.add(action);
      if (recordExactEdge) Input._freshExactUp.add(action);
    }

    Input._actionStates.set(action, result);
  }

  /** 每帧重新评估全部动作（覆盖手柄轴这类“没有明显边沿”的输入）。 */
  private static _evaluateActions(): void {
    const map = InputMap.singleton;
    const actions = map.getActions();
    const activeActions = new Set(actions);
    for (const action of Input._actionStates.keys()) {
      if (!activeActions.has(action)) Input._removeActionState(action);
    }
    Input._inputMapRevision = map.revision;
    for (const action of actions) {
      Input._recordActionState(action, Input._evaluateAction(action));
    }
  }

  /** 映射发生增删改后，让运行时快照立即跟上。 */
  private static _syncInputMap(): void {
    if (Input._inputMapRevision === InputMap.singleton.revision) return;
    Input._evaluateActions();
  }

  private static _removeActionState(action: string): void {
    Input._actionStates.delete(action);
    Input._freshDown.delete(action);
    Input._freshUp.delete(action);
    Input._carryDown.delete(action);
    Input._carryUp.delete(action);
    Input._readDown.delete(action);
    Input._readUp.delete(action);
    Input._freshExactDown.delete(action);
    Input._freshExactUp.delete(action);
    Input._carryExactDown.delete(action);
    Input._carryExactUp.delete(action);
    Input._readExactDown.delete(action);
    Input._readExactUp.delete(action);
  }

  /**
   * 读取一个边沿标记。
   *
   * - 本帧已经读过：直接返回 `true`，保证同一帧内多次查询结果一致；
   * - 本帧新产生、或上一帧产生但一直没人读：返回 `true` 并记录为“已读”，
   *   这样无论 `Input.update()` 在游戏逻辑之前还是之后结算，按键都不会被漏掉；
   * - 其余情况一律 `false`：边沿只会被上报一帧。
   */
  private static _readEdge(action: string, fresh: Set<string>, carry: Set<string>, read: Set<string>): boolean {
    if (read.has(action)) return true;
    if (!fresh.has(action) && !carry.has(action)) return false;
    fresh.delete(action);
    carry.delete(action);
    read.add(action);
    return true;
  }

  /** 引擎帧标识（`Laya.timer` 的帧时间戳）；拿不到时返回 `null`。 */
  private static _engineFrameStamp(): number | null {
    const engine = Input._engine();
    const timer: any = engine ? engine.timer : null;
    if (!timer) return null;
    const stamp: any = timer.currTimer ?? timer.currFrame;
    return typeof stamp === "number" ? stamp : null;
  }

  /**
   * 由 `Input.update()` 调用：推进到新的一帧。
   *
   * 拿得到引擎帧号时，同一个引擎帧内重复调用（自动帧循环 + 手动调用）只结算一次；
   * 拿不到引擎帧号时（例如纯单元测试环境）退化为「按调用次数计」。
   */
  private static _beginFrame(): void {
    const stamp = Input._engineFrameStamp();
    if (stamp !== null) {
      if (stamp === Input._lastTickStamp) return;
      Input._lastTickStamp = stamp;
    }
    Input._advanceFrame();
  }

  /**
   * 查询边沿时调用：如果引擎已经进入新的一帧就顺手结算一次。
   *
   * 这是「没人调用 `Input.update()`」时的保险：按键事件本身即时生效，
   * 但不能因为没人结算，就一直停在上一帧的状态上（那样 `just_pressed` 会永远为 true）。
   */
  private static _syncFrame(): void {
    const stamp = Input._engineFrameStamp();
    if (stamp === null || stamp === Input._lastTickStamp) return;
    Input._lastTickStamp = stamp;
    Input._advanceFrame();
  }

  /** 推进一帧：上一帧没被读到的边沿留到本帧补读一次，其余边沿作废。 */
  private static _advanceFrame(): void {
    Input._readDown.clear();
    Input._readUp.clear();
    Input._readExactDown.clear();
    Input._readExactUp.clear();
    Input._carryDown = Input._freshDown;
    Input._carryUp = Input._freshUp;
    Input._carryExactDown = Input._freshExactDown;
    Input._carryExactUp = Input._freshExactUp;
    Input._freshDown = new Set();
    Input._freshUp = new Set();
    Input._freshExactDown = new Set();
    Input._freshExactUp = new Set();
  }

  /** 清空全部边沿标记。 */
  private static _clearEdges(): void {
    Input._freshDown.clear();
    Input._freshUp.clear();
    Input._carryDown.clear();
    Input._carryUp.clear();
    Input._readDown.clear();
    Input._readUp.clear();
    Input._freshExactDown.clear();
    Input._freshExactUp.clear();
    Input._carryExactDown.clear();
    Input._carryExactUp.clear();
    Input._readExactDown.clear();
    Input._readExactUp.clear();
  }

  /** 评估单个动作当前状态。 */
  private static _evaluateAction(
    action: string,
    exactMatch: boolean = false
  ): { pressed: boolean; strength: number; rawStrength: number } {
    const map = InputMap.singleton;
    const deadzone = map.actionGetDeadzone(action);

    // 1) 代码强制状态优先级最高。
    const forced = map.getForcedAction(action);
    if (forced && forced.pressed) {
      const strength = Math.min(Math.max(forced.strength, 0), 1);
      return { pressed: true, strength, rawStrength: forced.strength };
    }

    // 2) 逐个绑定事件对照当前输入状态。
    let pressed = false;
    let rawStrength = 0;
    for (const rule of map.actionGetEvents(action)) {
      const value = Input._evaluateRule(rule, deadzone, exactMatch);
      if (value === null) continue;
      if (value > 0) pressed = true;
      rawStrength = Math.max(rawStrength, value);
    }
    if (!pressed && rawStrength === 0) {
      return { pressed: false, strength: 0, rawStrength: 0 };
    }

    return {
      pressed,
      strength: normalizeStrength(rawStrength, deadzone),
      rawStrength,
    };
  }

  /**
   * 把一条绑定规则与当前输入状态比对。
   * @returns 命中时返回强度（>0 表示按下），未命中返回 `null`。
   */
  private static _evaluateRule(rule: InputEvent, deadzone: number, exactMatch: boolean = false): number | null {
    if (rule instanceof InputEventKey) {
      if (!Input._modifiersMatchCurrentState(rule, exactMatch)) return null;
      const hit =
        (rule.keycode !== Key.NONE && Input._pressedKeys.has(rule.keycode)) ||
        (rule.physicalKeycode !== Key.NONE && Input._pressedPhysicalKeys.has(rule.physicalKeycode)) ||
        (rule.keyLabel !== Key.NONE && Input._pressedKeyLabels.has(rule.keyLabel));
      return hit ? 1 : null;
    }
    if (rule instanceof InputEventMouseButton) {
      if (!Input._modifiersMatchCurrentState(rule, exactMatch)) return null;
      return Input._pressedMouseButtons.has(rule.buttonIndex) ? 1 : null;
    }
    if (rule instanceof InputEventJoypadButton) {
      if (Input._ignoringJoypad) return null;
      if (rule.device >= 0) {
        const joypad = Input._joypads.get(rule.device);
        if (joypad?.connected && joypad.buttons[rule.buttonIndex] === true) return 1;
        return Input._injectedJoyButtons.get(rule.device)?.has(rule.buttonIndex) ? 1 : null;
      }
      for (const joypad of Input._joypads.values()) {
        if (joypad.connected && joypad.buttons[rule.buttonIndex] === true) return 1;
      }
      for (const buttons of Input._injectedJoyButtons.values()) {
        if (buttons.has(rule.buttonIndex)) return 1;
      }
      return null;
    }
    if (rule instanceof InputEventJoypadMotion) {
      if (Input._ignoringJoypad) return null;
      let strongest: number | null = null;
      for (const joypad of Input._joypads.values()) {
        if (!joypad.connected || (rule.device >= 0 && joypad.index !== rule.device)) continue;
        const value = joypad.axes[rule.axis] ?? 0;
        if (Math.sign(value) !== Math.sign(rule.axisValue)) continue;
        const magnitude = Math.abs(value);
        if (magnitude >= deadzone && (strongest === null || magnitude > strongest)) strongest = magnitude;
      }
      for (const [device, axes] of Input._injectedJoyAxes) {
        if (rule.device >= 0 && device !== rule.device) continue;
        const value = axes.get(rule.axis) ?? 0;
        if (Math.sign(value) !== Math.sign(rule.axisValue)) continue;
        const magnitude = Math.abs(value);
        if (magnitude >= deadzone && (strongest === null || magnitude > strongest)) strongest = magnitude;
      }
      return strongest;
    }
    return null;
  }

  private static _modifiersMatchCurrentState(
    rule: { altPressed: boolean; shiftPressed: boolean; ctrlPressed: boolean; metaPressed: boolean },
    exactMatch: boolean
  ): boolean {
    const alt = Input._pressedKeys.has(Key.ALT) || Input._pressedPhysicalKeys.has(Key.ALT);
    const shift = Input._pressedKeys.has(Key.SHIFT) || Input._pressedPhysicalKeys.has(Key.SHIFT);
    const ctrl = Input._pressedKeys.has(Key.CTRL) || Input._pressedPhysicalKeys.has(Key.CTRL);
    const meta = Input._pressedKeys.has(Key.META) || Input._pressedPhysicalKeys.has(Key.META);
    if (exactMatch) {
      return (
        rule.altPressed === alt &&
        rule.shiftPressed === shift &&
        rule.ctrlPressed === ctrl &&
        rule.metaPressed === meta
      );
    }
    return (
      (!rule.altPressed || alt) &&
      (!rule.shiftPressed || shift) &&
      (!rule.ctrlPressed || ctrl) &&
      (!rule.metaPressed || meta)
    );
  }

  /** 单调时钟（毫秒）。 */
  private static _now(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
    return Date.now();
  }

  /** 轮询 Web Gamepad API，生成手柄边沿事件。 */
  private static _pollJoypads(): void {
    const nav: any = typeof navigator !== "undefined" ? navigator : null;
    if (!nav || typeof nav.getGamepads !== "function") return;
    if (Input._ignoringJoypad) return;
    if (Input._ignoreJoypadOnUnfocused && typeof document !== "undefined" && document.hasFocus && !document.hasFocus()) {
      Input._clearJoypadInputState();
      return;
    }

    const rawPads = nav.getGamepads();
    if (!rawPads) return;

    for (let i = 0; i < rawPads.length; i++) {
      const raw = rawPads[i] as Gamepad | null;
      const state = Input._joypads.get(i);

      if (!raw) {
        if (state && state.connected) {
          state.connected = false;
          state.prevButtons = state.buttons.slice();
          state.prevAxes = state.axes.slice();
          state.buttons.fill(false);
          state.axes.fill(0);
          Input._notifyJoyConnection(i, false);
        }
        continue;
      }

      if (!state) {
        Input._joypads.set(i, {
          index: i,
          name: raw.id || `Gamepad ${i}`,
          guid: raw.id || `gamepad-${i}`,
          connected: true,
          buttons: new Array<boolean>(JoyButton.MAX).fill(false),
          axes: new Array<number>(JoyAxis.MAX).fill(0),
          prevButtons: new Array<boolean>(JoyButton.MAX).fill(false),
          prevAxes: new Array<number>(JoyAxis.MAX).fill(0),
        });
        Input._notifyJoyConnection(i, true);
      } else if (!state.connected) {
        state.connected = true;
        Input._notifyJoyConnection(i, true);
      }

      const joypad = Input._joypads.get(i)!;
      const nextButtons = new Array<boolean>(JoyButton.MAX).fill(false);
      const nextAxes = new Array<number>(JoyAxis.MAX).fill(0);

      for (let b = 0; b < raw.buttons.length; b++) {
        const mapped = GAMEPAD_BUTTON_MAP[b] ?? joyButtonFromGamepadIndex(b);
        if (mapped === undefined || mapped === JoyButton.MAX || mapped < 0) continue;
        const rawButton = raw.buttons[b];
        if (rawButton) nextButtons[mapped] = rawButton.pressed || rawButton.value > 0.5;
      }

      if (raw.axes.length >= 4) {
        for (let a = 0; a < 4; a++) {
          const mapped = joyAxisFromGamepadIndex(a);
          if (mapped < 0) continue;
          nextAxes[mapped] = Input._applyAxisDeadzone(raw.axes[a] ?? 0);
        }
      }
      const leftTrigger = raw.buttons[6];
      if (leftTrigger) {
        // 标准 Gamepad 把扳机放在 buttons[6/7]，Godot 则把它们暴露为 -1 ~ 1 的轴。
        nextAxes[JoyAxis.TRIGGER_LEFT] = Math.min(Math.max(leftTrigger.value, 0), 1) * 2 - 1;
      }
      const rightTrigger = raw.buttons[7];
      if (rightTrigger) {
        nextAxes[JoyAxis.TRIGGER_RIGHT] = Math.min(Math.max(rightTrigger.value, 0), 1) * 2 - 1;
      }

      // 先记下边沿，再落地新状态，最后派发事件：
      // `_applyEvent()` 会同步重新评估动作，必须读到最新的按键 / 轴数据。
      const buttonEdges: Array<{ index: JoyButton; pressed: boolean }> = [];
      for (let b = 0; b < JoyButton.MAX; b++) {
        const nextPressed = nextButtons[b] ?? false;
        if (nextPressed !== (joypad.buttons[b] ?? false)) {
          buttonEdges.push({ index: b as JoyButton, pressed: nextPressed });
        }
      }
      const axisEdges: JoyAxis[] = [];
      for (let a = 0; a < JoyAxis.MAX; a++) {
        if (Math.abs((nextAxes[a] ?? 0) - (joypad.axes[a] ?? 0)) >= 0.01) axisEdges.push(a as JoyAxis);
      }

      joypad.prevButtons = joypad.buttons.slice();
      joypad.prevAxes = joypad.axes.slice();
      joypad.buttons = nextButtons;
      joypad.axes = nextAxes;

      for (const edge of buttonEdges) {
        const event = new InputEventJoypadButton();
        event.device = i;
        event.buttonIndex = edge.index;
        event.pressed = edge.pressed;
        event.pressure = edge.pressed ? 1 : 0;
        Input._dispatchInputEvent(event, false);
      }
      for (const axis of axisEdges) {
        const event = new InputEventJoypadMotion();
        event.device = i;
        event.axis = axis;
        event.axisValue = nextAxes[axis] ?? 0;
        Input._dispatchInputEvent(event, false);
      }
    }
  }

  /** 清空手柄输入快照但保留连接信息，重新启用后由下一次轮询恢复。 */
  private static _clearJoypadInputState(): void {
    for (const joypad of Input._joypads.values()) {
      joypad.prevButtons = joypad.buttons.slice();
      joypad.prevAxes = joypad.axes.slice();
      joypad.buttons.fill(false);
      joypad.axes.fill(0);
    }
    Input._injectedJoyButtons.clear();
    Input._injectedJoyAxes.clear();
  }

  /** 摇杆的硬件死区，避免回中漂移。 */
  private static _applyAxisDeadzone(value: number): number {
    const HARDWARE_DEADZONE = 0.08;
    if (Math.abs(value) < HARDWARE_DEADZONE) return 0;
    return value;
  }

  /** 触发手柄连接变化回调。 */
  private static _notifyJoyConnection(device: number, connected: boolean): void {
    for (const listener of Input._joyConnectionListeners) {
      try {
        listener(device, connected);
      } catch (error) {
        console.error("[Input] joy_connection_changed 回调异常", error);
      }
    }
  }

  /** 取原始 Gamepad 对象。 */
  private static _getRawGamepad(device: number): any {
    const nav: any = typeof navigator !== "undefined" ? navigator : null;
    if (!nav || typeof nav.getGamepads !== "function") return null;
    const pads = nav.getGamepads();
    return pads ? pads[device] : null;
  }

}
