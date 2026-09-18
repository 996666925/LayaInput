/**
 * Godot `InputEvent` 家族的事件类型移植。
 *
 * 对应 Godot 4.x 的：
 * `InputEvent` / `InputEventKey` / `InputEventMouseButton` / `InputEventMouseMotion` /
 * `InputEventJoypadButton` / `InputEventJoypadMotion` / `InputEventAction` /
 * `InputEventScreenTouch` / `InputEventScreenDrag`
 *
 * 本文件不直接依赖 Laya 运行时，编辑器扩展可以安全引入。
 */

import {
  InputEventType,
  JoyAxis,
  JoyButton,
  Key,
  MouseButton,
  keyToString,
  joyAxisToDisplayName,
  joyButtonToDisplayName,
  mouseButtonToString,
} from "./InputEnums";
import { InputMap } from "./InputMap";

/** 二维向量（与 Godot 的 `Vector2` 对应）。 */
export interface Vec2 {
  x: number;
  y: number;
}

/** 三维向量（与 Godot 的 `Vector3` 对应）。 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 四元数（与 Godot 的 `Quaternion` 对应）。 */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** 创建二维向量。 */
export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

/** 创建三维向量。 */
export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

/** 创建四元数。 */
export function quat(x = 0, y = 0, z = 0, w = 1): Quat {
  return { x, y, z, w };
}

/**
 * 所有输入事件的基类。等价于 Godot 的 `InputEvent`。
 *
 * 与 Godot 不同的是，这里用一个 `type` 字符串字段做运行时判别，
 * 便于 JSON 序列化（编辑器扩展正是靠它保存输入映射）。
 */
export abstract class InputEvent {
  /** 事件类型判别标记。 */
  abstract readonly type: InputEventType;

  /** 触发该事件的设备 ID。等价于 `InputEvent.device`。 */
  device: number = -1;

  /** 事件是否处于“按下”状态。等价于 `InputEvent.is_pressed()`。 */
  abstract isPressed(): boolean;

  /** 是否为键盘连发事件。等价于 `InputEvent.is_echo()`。 */
  isEcho(): boolean {
    return false;
  }

  /** 人类可读的事件描述，等价于 `InputEvent.as_text()`。 */
  abstract asText(): string;

  /**
   * 该事件是否触发指定动作。等价于 `InputEvent.is_action()`，
   * 内部委托给 `InputMap.eventIsAction()`。
   */
  isAction(action: string, exactMatch: boolean = false): boolean {
    return InputMap.singleton.eventIsAction(this, action, exactMatch);
  }

  /**
   * 判断“传入的运行时事件”是否能匹配当前这个作为映射规则的事件。
   * 等价于 Godot 的 `InputEvent::action_match()`。
   *
   * @param event     实际发生的输入事件。
   * @param out       输出：是否处于按下状态与动作强度。
   * @param deadzone  死区，用于手柄轴判定。
   * @param exactMatch 是否要求精确匹配设备。
   */
  abstract actionMatch(event: InputEvent, out: ActionMatchResult, deadzone: number, exactMatch?: boolean): boolean;

  /**
   * 比较两条事件的映射配置，等价于 Godot 的 `InputEvent::is_match()`。
   * `pressed` / `echo` 等瞬时运行时状态不参与比较。
   */
  isMatch(event: InputEvent): boolean {
    return this === event;
  }

  /** 序列化为纯数据对象，便于写入 JSON 配置。 */
  abstract toJSON(): any;

  /** 从纯数据对象反序列化。 */
  static fromJSON(data: any): InputEvent | null {
    if (!data || typeof data !== "object") return null;
    switch (data.type as InputEventType) {
      case InputEventType.KEY:
        return InputEventKey.fromJSON(data);
      case InputEventType.MOUSE_BUTTON:
        return InputEventMouseButton.fromJSON(data);
      case InputEventType.MOUSE_MOTION:
        return InputEventMouseMotion.fromJSON(data);
      case InputEventType.JOY_BUTTON:
        return InputEventJoypadButton.fromJSON(data);
      case InputEventType.JOY_MOTION:
        return InputEventJoypadMotion.fromJSON(data);
      case InputEventType.ACTION:
        return InputEventAction.fromJSON(data);
      case InputEventType.SCREEN_TOUCH:
        return InputEventScreenTouch.fromJSON(data);
      case InputEventType.SCREEN_DRAG:
        return InputEventScreenDrag.fromJSON(data);
      default:
        return null;
    }
  }
}

/** `actionMatch` 的输出结果。 */
export interface ActionMatchResult {
  pressed: boolean;
  strength: number;
}

/** 一个按键事件的“按键身份”：`keycode` / `physicalKeycode` / `keyLabel` 三者任一命中即可。 */
function keyIdentityMatch(rule: InputEventKey, event: InputEventKey): boolean {
  if (rule.keycode !== Key.NONE && event.keycode === rule.keycode) return true;
  if (rule.physicalKeycode !== Key.NONE && event.physicalKeycode === rule.physicalKeycode) return true;
  if (rule.keyLabel !== Key.NONE && event.keyLabel === rule.keyLabel) return true;
  return false;
}

/** 映射中声明的修饰键必须存在；精确匹配时也不允许额外修饰键。 */
function modifiersMatch(
  rule: { altPressed: boolean; shiftPressed: boolean; ctrlPressed: boolean; metaPressed: boolean },
  event: { altPressed: boolean; shiftPressed: boolean; ctrlPressed: boolean; metaPressed: boolean },
  exactMatch: boolean
): boolean {
  if (exactMatch) {
    return (
      rule.altPressed === event.altPressed &&
      rule.shiftPressed === event.shiftPressed &&
      rule.ctrlPressed === event.ctrlPressed &&
      rule.metaPressed === event.metaPressed
    );
  }
  return (
    (!rule.altPressed || event.altPressed) &&
    (!rule.shiftPressed || event.shiftPressed) &&
    (!rule.ctrlPressed || event.ctrlPressed) &&
    (!rule.metaPressed || event.metaPressed)
  );
}

/**
 * 键盘事件。等价于 Godot 的 `InputEventKey`。
 */
export class InputEventKey extends InputEvent {
  readonly type = InputEventType.KEY;

  /** 逻辑键码（受键盘布局影响）。 */
  keycode: Key = Key.NONE;
  /** 物理键码（对应浏览器 `KeyboardEvent.code`）。 */
  physicalKeycode: Key = Key.NONE;
  /** 按键标签（`KeyboardEvent.key` 归一化后的结果）。 */
  keyLabel: Key = Key.NONE;

  /** 是否为 Unicode 字符输入。 */
  unicode: number = 0;
  /** 字符。 */
  keyText: string = "";

  altPressed = false;
  shiftPressed = false;
  ctrlPressed = false;
  metaPressed = false;

  private _pressed = false;
  private _echo = false;

  get pressed(): boolean {
    return this._pressed;
  }
  set pressed(value: boolean) {
    this._pressed = value;
  }

  get echo(): boolean {
    return this._echo;
  }
  set echo(value: boolean) {
    this._echo = value;
  }

  isPressed(): boolean {
    return this._pressed;
  }

  isEcho(): boolean {
    return this._echo;
  }

  /** 主键码，优先返回逻辑键码。 */
  get mainKey(): Key {
    return this.keycode !== Key.NONE ? this.keycode : this.physicalKeycode;
  }

  asText(): string {
    const name = keyToString(this.mainKey);
    return `<${this._pressed ? " pressed" : " released"}> ${name}`;
  }

  actionMatch(event: InputEvent, out: ActionMatchResult, _deadzone: number, exactMatch = false): boolean {
    const other = event as InputEventKey;
    if (!(other instanceof InputEventKey)) return false;
    if (!keyIdentityMatch(this, other)) return false;
    if (this.device >= 0 && this.device !== other.device) return false;
    if (!modifiersMatch(this, other, exactMatch)) return false;
    out.pressed = other.isPressed();
    out.strength = out.pressed ? 1 : 0;
    return true;
  }

  isMatch(event: InputEvent): boolean {
    const other = event as InputEventKey;
    if (!(other instanceof InputEventKey)) return false;
    return (
      this.keycode === other.keycode &&
      this.physicalKeycode === other.physicalKeycode &&
      this.keyLabel === other.keyLabel &&
      this.altPressed === other.altPressed &&
      this.shiftPressed === other.shiftPressed &&
      this.ctrlPressed === other.ctrlPressed &&
      this.metaPressed === other.metaPressed &&
      this.device === other.device
    );
  }

  toJSON(): any {
    return {
      type: this.type,
      device: this.device,
      keycode: this.keycode,
      physicalKeycode: this.physicalKeycode,
      keyLabel: this.keyLabel,
      altPressed: this.altPressed,
      shiftPressed: this.shiftPressed,
      ctrlPressed: this.ctrlPressed,
      metaPressed: this.metaPressed,
    };
  }

  static fromJSON(data: any): InputEventKey {
    const ev = new InputEventKey();
    ev.device = data.device ?? -1;
    ev.keycode = data.keycode ?? Key.NONE;
    ev.physicalKeycode = data.physicalKeycode ?? Key.NONE;
    ev.keyLabel = data.keyLabel ?? Key.NONE;
    ev.altPressed = !!data.altPressed;
    ev.shiftPressed = !!data.shiftPressed;
    ev.ctrlPressed = !!data.ctrlPressed;
    ev.metaPressed = !!data.metaPressed;
    return ev;
  }
}

/**
 * 鼠标按键事件。等价于 Godot 的 `InputEventMouseButton`。
 */
export class InputEventMouseButton extends InputEvent {
  readonly type = InputEventType.MOUSE_BUTTON;

  buttonIndex: MouseButton = MouseButton.NONE;
  /** 滚轮/触控板的滚动系数。 */
  factor: number = 1;
  position: Vec2 = vec2();
  globalPosition: Vec2 = vec2();

  altPressed = false;
  shiftPressed = false;
  ctrlPressed = false;
  metaPressed = false;

  buttonMask: number = 0;
  /** 是否双击。 */
  doubleClick = false;

  private _pressed = false;

  get pressed(): boolean {
    return this._pressed;
  }
  set pressed(value: boolean) {
    this._pressed = value;
  }

  isPressed(): boolean {
    return this._pressed;
  }

  asText(): string {
    return `<${this._pressed ? " pressed" : " released"}> ${mouseButtonToString(this.buttonIndex)}`;
  }

  actionMatch(event: InputEvent, out: ActionMatchResult, _deadzone: number, exactMatch = false): boolean {
    const other = event as InputEventMouseButton;
    if (!(other instanceof InputEventMouseButton)) return false;
    if (this.buttonIndex !== other.buttonIndex) return false;
    if (this.device >= 0 && this.device !== other.device) return false;
    if (!modifiersMatch(this, other, exactMatch)) return false;
    out.pressed = other.isPressed();
    out.strength = out.pressed ? 1 : 0;
    return true;
  }

  isMatch(event: InputEvent): boolean {
    const other = event as InputEventMouseButton;
    if (!(other instanceof InputEventMouseButton)) return false;
    return (
      this.buttonIndex === other.buttonIndex &&
      this.altPressed === other.altPressed &&
      this.shiftPressed === other.shiftPressed &&
      this.ctrlPressed === other.ctrlPressed &&
      this.metaPressed === other.metaPressed &&
      this.device === other.device
    );
  }

  toJSON(): any {
    return {
      type: this.type,
      device: this.device,
      buttonIndex: this.buttonIndex,
      altPressed: this.altPressed,
      shiftPressed: this.shiftPressed,
      ctrlPressed: this.ctrlPressed,
      metaPressed: this.metaPressed,
    };
  }

  static fromJSON(data: any): InputEventMouseButton {
    const ev = new InputEventMouseButton();
    ev.device = data.device ?? -1;
    ev.buttonIndex = data.buttonIndex ?? MouseButton.NONE;
    ev.altPressed = !!data.altPressed;
    ev.shiftPressed = !!data.shiftPressed;
    ev.ctrlPressed = !!data.ctrlPressed;
    ev.metaPressed = !!data.metaPressed;
    return ev;
  }
}

/** 鼠标移动事件。等价于 Godot 的 `InputEventMouseMotion`。只在特殊场景需要绑定动作。 */
export class InputEventMouseMotion extends InputEvent {
  readonly type = InputEventType.MOUSE_MOTION;

  position: Vec2 = vec2();
  globalPosition: Vec2 = vec2();
  relative: Vec2 = vec2();
  velocity: Vec2 = vec2();
  pressure: number = 0;
  buttonMask: number = 0;
  altPressed = false;
  shiftPressed = false;
  ctrlPressed = false;
  metaPressed = false;

  isPressed(): boolean {
    return false;
  }

  asText(): string {
    return `<Mouse Motion> (${this.position.x}, ${this.position.y})`;
  }

  actionMatch(): boolean {
    return false;
  }

  toJSON(): any {
    return { type: this.type, device: this.device };
  }

  static fromJSON(data: any): InputEventMouseMotion {
    const ev = new InputEventMouseMotion();
    ev.device = data.device ?? -1;
    return ev;
  }
}

/**
 * 手柄按键事件。等价于 Godot 的 `InputEventJoypadButton`。
 */
export class InputEventJoypadButton extends InputEvent {
  readonly type = InputEventType.JOY_BUTTON;

  buttonIndex: JoyButton = JoyButton.INVALID;
  pressure: number = 0;
  private _pressed = false;

  get pressed(): boolean {
    return this._pressed;
  }
  set pressed(value: boolean) {
    this._pressed = value;
  }

  isPressed(): boolean {
    return this._pressed;
  }

  asText(): string {
    return `<${this._pressed ? " pressed" : " released"}> Joypad ${joyButtonToDisplayName(this.buttonIndex)}`;
  }

  actionMatch(event: InputEvent, out: ActionMatchResult, _deadzone: number, _exactMatch = false): boolean {
    const other = event as InputEventJoypadButton;
    if (!(other instanceof InputEventJoypadButton)) return false;
    if (this.buttonIndex !== other.buttonIndex) return false;
    if (this.device >= 0 && this.device !== other.device) return false;
    out.pressed = other.isPressed();
    out.strength = other.pressure > 0 ? other.pressure : out.pressed ? 1 : 0;
    return true;
  }

  isMatch(event: InputEvent): boolean {
    const other = event as InputEventJoypadButton;
    if (!(other instanceof InputEventJoypadButton)) return false;
    return this.buttonIndex === other.buttonIndex && this.device === other.device;
  }

  toJSON(): any {
    return { type: this.type, device: this.device, buttonIndex: this.buttonIndex };
  }

  static fromJSON(data: any): InputEventJoypadButton {
    const ev = new InputEventJoypadButton();
    ev.device = data.device ?? -1;
    ev.buttonIndex = data.buttonIndex ?? JoyButton.INVALID;
    return ev;
  }
}

/**
 * 手柄轴事件。等价于 Godot 的 `InputEventJoypadMotion`。
 */
export class InputEventJoypadMotion extends InputEvent {
  readonly type = InputEventType.JOY_MOTION;

  axis: JoyAxis = JoyAxis.INVALID;
  axisValue: number = 0;

  isPressed(): boolean {
    return Math.abs(this.axisValue) > 0;
  }

  asText(): string {
    return `<Joypad Motion> ${joyAxisToDisplayName(this.axis)} ${this.axisValue.toFixed(2)}`;
  }

  actionMatch(event: InputEvent, out: ActionMatchResult, deadzone: number, _exactMatch = false): boolean {
    const other = event as InputEventJoypadMotion;
    if (!(other instanceof InputEventJoypadMotion)) return false;
    if (this.axis !== other.axis) return false;
    if (Math.sign(this.axisValue) !== Math.sign(other.axisValue)) return false;
    if (Math.abs(other.axisValue) < deadzone) return false;
    if (this.device >= 0 && this.device !== other.device) return false;
    out.pressed = true;
    out.strength = Math.abs(other.axisValue);
    return true;
  }

  isMatch(event: InputEvent): boolean {
    const other = event as InputEventJoypadMotion;
    if (!(other instanceof InputEventJoypadMotion)) return false;
    return this.axis === other.axis && this.axisValue === other.axisValue && this.device === other.device;
  }

  toJSON(): any {
    return { type: this.type, device: this.device, axis: this.axis, axisValue: this.axisValue };
  }

  static fromJSON(data: any): InputEventJoypadMotion {
    const ev = new InputEventJoypadMotion();
    ev.device = data.device ?? -1;
    ev.axis = data.axis ?? JoyAxis.INVALID;
    ev.axisValue = data.axisValue ?? 0;
    return ev;
  }
}

/**
 * 动作事件。可由代码直接派发，等价于 Godot 的 `InputEventAction`。
 */
export class InputEventAction extends InputEvent {
  readonly type = InputEventType.ACTION;

  action: string = "";
  strength: number = 1;

  private _pressed = false;

  get pressed(): boolean {
    return this._pressed;
  }
  set pressed(value: boolean) {
    this._pressed = value;
  }

  isPressed(): boolean {
    return this._pressed;
  }

  asText(): string {
    return `<${this._pressed ? " pressed" : " released"}> ${this.action}`;
  }

  actionMatch(event: InputEvent, out: ActionMatchResult, _deadzone: number): boolean {
    const other = event as InputEventAction;
    if (!(other instanceof InputEventAction)) return false;
    if (this.action !== other.action) return false;
    out.pressed = other.isPressed();
    out.strength = out.pressed ? (other.strength === 0 ? 1 : other.strength) : 0;
    return true;
  }

  isMatch(event: InputEvent): boolean {
    const other = event as InputEventAction;
    if (!(other instanceof InputEventAction)) return false;
    return this.action === other.action && this.strength === other.strength && this.device === other.device;
  }

  toJSON(): any {
    return { type: this.type, device: this.device, action: this.action, strength: this.strength };
  }

  static fromJSON(data: any): InputEventAction {
    const ev = new InputEventAction();
    ev.device = data.device ?? -1;
    ev.action = data.action ?? "";
    ev.strength = data.strength ?? 1;
    return ev;
  }
}

/** 触摸按下/抬起事件。等价于 Godot 的 `InputEventScreenTouch`。 */
export class InputEventScreenTouch extends InputEvent {
  readonly type = InputEventType.SCREEN_TOUCH;

  index: number = 0;
  position: Vec2 = vec2();
  doubleTap = false;
  private _pressed = false;

  get pressed(): boolean {
    return this._pressed;
  }
  set pressed(value: boolean) {
    this._pressed = value;
  }

  isPressed(): boolean {
    return this._pressed;
  }

  asText(): string {
    return `<${this._pressed ? " pressed" : " released"}> Touch ${this.index}`;
  }

  actionMatch(): boolean {
    return false;
  }

  toJSON(): any {
    return { type: this.type, device: this.device, index: this.index };
  }

  static fromJSON(data: any): InputEventScreenTouch {
    const ev = new InputEventScreenTouch();
    ev.device = data.device ?? -1;
    ev.index = data.index ?? 0;
    return ev;
  }
}

/** 触摸拖动事件。等价于 Godot 的 `InputEventScreenDrag`。 */
export class InputEventScreenDrag extends InputEvent {
  readonly type = InputEventType.SCREEN_DRAG;

  index: number = 0;
  position: Vec2 = vec2();
  relative: Vec2 = vec2();
  velocity: Vec2 = vec2();
  pressure: number = 0;

  isPressed(): boolean {
    return true;
  }

  asText(): string {
    return `<Screen Drag> Touch ${this.index}`;
  }

  actionMatch(): boolean {
    return false;
  }

  toJSON(): any {
    return { type: this.type, device: this.device, index: this.index };
  }

  static fromJSON(data: any): InputEventScreenDrag {
    const ev = new InputEventScreenDrag();
    ev.device = data.device ?? -1;
    ev.index = data.index ?? 0;
    return ev;
  }
}

/** 由运行时输入事件创建对应的映射规则事件（用于编辑器“按下即捕获”）。 */
export function createMappingEventFromRuntimeEvent(event: InputEvent): InputEvent | null {
  if (event instanceof InputEventKey) {
    const ev = new InputEventKey();
    ev.keycode = event.keycode;
    ev.physicalKeycode = event.physicalKeycode;
    ev.keyLabel = event.keyLabel;
    ev.device = event.device;
    ev.altPressed = event.altPressed;
    ev.shiftPressed = event.shiftPressed;
    ev.ctrlPressed = event.ctrlPressed;
    ev.metaPressed = event.metaPressed;
    return ev;
  }
  if (event instanceof InputEventMouseButton) {
    const ev = new InputEventMouseButton();
    ev.buttonIndex = event.buttonIndex;
    ev.device = event.device;
    ev.altPressed = event.altPressed;
    ev.shiftPressed = event.shiftPressed;
    ev.ctrlPressed = event.ctrlPressed;
    ev.metaPressed = event.metaPressed;
    return ev;
  }
  if (event instanceof InputEventJoypadButton) {
    const ev = new InputEventJoypadButton();
    ev.buttonIndex = event.buttonIndex;
    ev.device = event.device;
    return ev;
  }
  if (event instanceof InputEventJoypadMotion) {
    const ev = new InputEventJoypadMotion();
    ev.axis = event.axis;
    ev.axisValue = Math.sign(event.axisValue) || 1;
    ev.device = event.device;
    return ev;
  }
  return null;
}
