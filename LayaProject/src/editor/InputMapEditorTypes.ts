/**
 * 输入映射编辑器扩展用到的数据结构与转换逻辑。
 *
 * 运行在 IDE 的 UI 进程，因此不能引用 Laya 运行时。
 */

import {
  InputEventType,
  JoyAxis,
  JoyButton,
  Key,
  MouseButton,
  joyAxisToDisplayName,
  joyButtonToDisplayName,
  keyToString,
  mouseButtonToString,
  stringToKey,
} from "./InputEnums";
import {
  InputEvent,
  InputEventJoypadButton,
  InputEventJoypadMotion,
  InputEventKey,
  InputEventMouseButton,
} from "./InputEvent";

/* ------------------------------------------------------------------ */
/*                            下拉选项                                */
/* ------------------------------------------------------------------ */

export const MOUSE_BUTTON_CHOICES = [
  { name: "鼠标左键", value: MouseButton.LEFT },
  { name: "鼠标右键", value: MouseButton.RIGHT },
  { name: "鼠标中键", value: MouseButton.MIDDLE },
  { name: "滚轮上滚", value: MouseButton.WHEEL_UP },
  { name: "滚轮下滚", value: MouseButton.WHEEL_DOWN },
];

/* ------------------------------------------------------------------ */
/*                            数据模型                                */
/* ------------------------------------------------------------------ */

/** 一条输入事件的绑定规则。 */
export class InputEventData {
  /** 事件类型，取自 `InputEventType`。 */
  public type: string = InputEventType.KEY;

  /** 键盘按键名，如 `W` / `Space` / `F1`。 */
  public key: string = "";

  /** 鼠标按键。 */
  public mouseButton: number = MouseButton.LEFT;

  /** 手柄按键。 */
  public joyButton: number = JoyButton.A;

  /** 手柄摇杆轴。 */
  public joyAxis: number = JoyAxis.LEFT_X;

  /** 手柄摇杆轴方向，只能是 +1 或 -1。 */
  public joyAxisValue: number = 1;

  /** 手柄设备 ID，`-1` 表示任意手柄。 */
  public device: number = -1;
}

/** 一个动作（action）的定义。 */
export class InputActionData {
  /** 动作名，例如 `move_forward`。 */
  public name: string = "new_action";

  /** 死区，取值 0 ~ 1。 */
  public deadzone: number = 0.2;

  /** 绑定的输入事件。 */
  public events: InputEventData[] = [];
}

/** 整份输入映射表。 */
export class InputMapData {
  /** 所有动作。 */
  public actions: InputActionData[] = [];
}

/* ------------------------------------------------------------------ */
/*                        编辑器数据 <-> 运行时事件                     */
/* ------------------------------------------------------------------ */

/** 编辑器数据 -> 运行时 `InputEvent`。无法转换时返回 null。 */
export function eventDataToRuntime(data: InputEventData): InputEvent | null {
  if (!data) return null;
  switch (data.type) {
    case InputEventType.KEY: {
      const key = stringToKey(data.key);
      if (key === Key.NONE) return null;
      const event = new InputEventKey();
      // 同时写入逻辑键码与物理键码：无论键盘布局如何都能命中，
      // 与 Godot 编辑器默认勾选“物理按键”的行为接近。
      event.keycode = key;
      event.physicalKeycode = key;
      return event;
    }
    case InputEventType.MOUSE_BUTTON: {
      const event = new InputEventMouseButton();
      event.buttonIndex = data.mouseButton as MouseButton;
      return event;
    }
    case InputEventType.JOY_BUTTON: {
      const event = new InputEventJoypadButton();
      event.buttonIndex = data.joyButton as JoyButton;
      event.device = data.device;
      return event;
    }
    case InputEventType.JOY_MOTION: {
      const event = new InputEventJoypadMotion();
      event.axis = data.joyAxis as JoyAxis;
      event.axisValue = data.joyAxisValue >= 0 ? 1 : -1;
      event.device = data.device;
      return event;
    }
    default:
      return null;
  }
}

/** 运行时 `InputEvent` -> 编辑器数据。 */
export function eventDataFromRuntime(event: InputEvent): InputEventData | null {
  const data = new InputEventData();
  if (event instanceof InputEventKey) {
    data.type = InputEventType.KEY;
    data.key = keyToString(event.keycode !== Key.NONE ? event.keycode : event.physicalKeycode);
    return data;
  }
  if (event instanceof InputEventMouseButton) {
    data.type = InputEventType.MOUSE_BUTTON;
    data.mouseButton = event.buttonIndex;
    return data;
  }
  if (event instanceof InputEventJoypadButton) {
    data.type = InputEventType.JOY_BUTTON;
    data.joyButton = event.buttonIndex;
    data.device = event.device;
    return data;
  }
  if (event instanceof InputEventJoypadMotion) {
    data.type = InputEventType.JOY_MOTION;
    data.joyAxis = event.axis;
    data.joyAxisValue = event.axisValue >= 0 ? 1 : -1;
    data.device = event.device;
    return data;
  }
  return null;
}

/**
 * 事件在列表行里显示的名字，尽量贴近 Godot 编辑器的写法：
 * 键盘事件只显示键名，其余事件带上一个简短的来源前缀。
 */
export function eventRowLabel(data: InputEventData): string {
  if (!data) return "(空)";
  switch (data.type) {
    case InputEventType.KEY:
      return data.key || "(未设置)";
    case InputEventType.MOUSE_BUTTON: {
      const item = MOUSE_BUTTON_CHOICES.find((choice) => choice.value === data.mouseButton);
      return item ? item.name : mouseButtonToString(data.mouseButton as MouseButton);
    }
    case InputEventType.JOY_BUTTON:
      return `手柄 ${joyButtonToDisplayName(data.joyButton as JoyButton)}`;
    case InputEventType.JOY_MOTION: {
      const direction = data.joyAxisValue >= 0 ? "+" : "-";
      return `手柄轴 ${joyAxisToDisplayName(data.joyAxis as JoyAxis)} (${direction})`;
    }
    default:
      return data.type;
  }
}

/** 单条事件的完整可读描述，用于状态栏与提示。 */
export function describeEventData(data: InputEventData): string {
  if (!data) return "(空)";
  if (data.type === InputEventType.KEY) return `键盘 ${data.key || "?"}`;
  const suffix = data.device !== undefined && data.device >= 0 && data.type !== InputEventType.MOUSE_BUTTON
    ? ` #${data.device}`
    : "";
  return `${eventRowLabel(data)}${suffix}`;
}

/* ------------------------------------------------------------------ */
/*                            JSON 读写                               */
/* ------------------------------------------------------------------ */

/** 编辑器数据 -> 与运行时 `InputMap.toJSON()` 一致的纯数据对象。 */
export function mapDataToJSON(data: InputMapData): any {
  const actions: any[] = [];
  const list = data && Array.isArray(data.actions) ? data.actions : [];
  for (const action of list) {
    const events: any[] = [];
    const rawEvents = action && Array.isArray(action.events) ? action.events : [];
    for (const rawEvent of rawEvents) {
      const runtimeEvent = eventDataToRuntime(rawEvent);
      if (runtimeEvent) events.push(runtimeEvent.toJSON());
    }
    actions.push({
      name: action.name,
      deadzone: typeof action.deadzone === "number" ? action.deadzone : 0.2,
      events,
    });
  }
  return { version: 1, actions };
}

/** 纯数据对象 -> 编辑器数据。 */
export function mapDataFromJSON(json: any): InputMapData {
  const result = new InputMapData();
  result.actions = [];
  if (!json) return result;

  const actions = Array.isArray(json) ? json : json.actions;
  if (!Array.isArray(actions)) return result;

  for (const rawAction of actions) {
    if (!rawAction || !rawAction.name) continue;
    const action = new InputActionData();
    action.name = rawAction.name;
    action.deadzone = typeof rawAction.deadzone === "number" ? rawAction.deadzone : 0.2;
    action.events = [];

    const rawEvents = Array.isArray(rawAction.events) ? rawAction.events : [];
    for (const rawEvent of rawEvents) {
      const runtimeEvent = InputEvent.fromJSON(rawEvent);
      if (!runtimeEvent) continue;
      const eventData = eventDataFromRuntime(runtimeEvent);
      if (eventData) action.events.push(eventData);
    }
    result.actions.push(action);
  }
  return result;
}

/** 生成一份便于上手的默认输入映射（与 Godot 新建项目的默认输入映射一致）。 */
export function createDefaultMapData(): InputMapData {
  const data = new InputMapData();
  data.actions = [];

  const add = (name: string, keys: string[]) => {
    const action = new InputActionData();
    action.name = name;
    action.deadzone = 0.2;
    action.events = keys.map((key) => {
      const event = new InputEventData();
      event.type = InputEventType.KEY;
      event.key = key;
      return event;
    });
    data.actions.push(action);
  };

  // 与 Godot 项目的默认 InputMap 保持一致
  add("ui_accept", ["Enter", "Space", "KpEnter"]);
  add("ui_select", ["Space"]);
  add("ui_cancel", ["Escape"]);
  add("ui_focus_next", ["Tab"]);
  add("ui_focus_prev", ["Shift+Tab"]);
  add("ui_left", ["Left", "A"]);
  add("ui_right", ["Right", "D"]);
  add("ui_up", ["Up", "W"]);
  add("ui_down", ["Down", "S"]);
  return data;
}

/** 给新动作取一个不与现有动作重名的名字。 */
export function makeUniqueActionName(data: InputMapData, base: string = "new_action"): string {
  const used = new Set((data.actions || []).map((action) => action.name));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}${index}`)) index++;
  return `${base}${index}`;
}
