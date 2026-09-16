/**
 * Godot 输入枚举与按键映射表（移植自 Godot 4.x 的 `Key` / `MouseButton` /
 * `JoyButton` / `JoyAxis` / `MouseMode` 等全局枚举）。
 *
 * 本文件不依赖 Laya 运行时与 DOM，编辑器扩展可以安全引入。
 */

/** Godot 中“不可打印键”的标志位（`KEY_SPECIAL`）。 */
const SPKEY = 1 << 22;

/**
 * 键盘按键码。取值与 Godot 4.x 的 `Key` 枚举完全一致：
 * - 可打印的 ASCII 字符键直接使用其 ASCII 码值（32 ~ 126）。
 * - 功能键、方向键、小键盘等使用 `SPKEY | 偏移` 的形式。
 *
 * @zh 对应 GDScript 中的 `KEY_*` 常量。
 */
export enum Key {
  NONE = 0,
  UNKNOWN = 8388607,
  SPECIAL = SPKEY,

  // ---- 符号 ----
  SPACE = 32,
  EXCLAM = 33,
  QUOTEDBL = 34,
  NUMBERSIGN = 35,
  DOLLAR = 36,
  PERCENT = 37,
  AMPERSAND = 38,
  APOSTROPHE = 39,
  PARENLEFT = 40,
  PARENRIGHT = 41,
  ASTERISK = 42,
  PLUS = 43,
  COMMA = 44,
  MINUS = 45,
  PERIOD = 46,
  SLASH = 47,

  // ---- 数字 ----
  NUM_0 = 48,
  NUM_1 = 49,
  NUM_2 = 50,
  NUM_3 = 51,
  NUM_4 = 52,
  NUM_5 = 53,
  NUM_6 = 54,
  NUM_7 = 55,
  NUM_8 = 56,
  NUM_9 = 57,

  COLON = 58,
  SEMICOLON = 59,
  LESS = 60,
  EQUAL = 61,
  GREATER = 62,
  QUESTION = 63,
  AT = 64,

  // ---- 字母 ----
  A = 65,
  B = 66,
  C = 67,
  D = 68,
  E = 69,
  F = 70,
  G = 71,
  H = 72,
  I = 73,
  J = 74,
  K = 75,
  L = 76,
  M = 77,
  N = 78,
  O = 79,
  P = 80,
  Q = 81,
  R = 82,
  S = 83,
  T = 84,
  U = 85,
  V = 86,
  W = 87,
  X = 88,
  Y = 89,
  Z = 90,

  BRACKETLEFT = 91,
  BACKSLASH = 92,
  BRACKETRIGHT = 93,
  ASCIICIRCUM = 94,
  UNDERSCORE = 95,
  QUOTELEFT = 96,
  BRACELEFT = 123,
  BAR = 124,
  BRACERIGHT = 125,
  ASCIITILDE = 126,
  YEN = 165,
  SECTION = 167,

  // ---- 功能键 ----
  ESCAPE = SPKEY | 0x01,
  TAB = SPKEY | 0x02,
  BACKTAB = SPKEY | 0x03,
  BACKSPACE = SPKEY | 0x04,
  ENTER = SPKEY | 0x05,
  KP_ENTER = SPKEY | 0x06,
  INSERT = SPKEY | 0x07,
  DELETE = SPKEY | 0x08,
  PAUSE = SPKEY | 0x09,
  PRINT = SPKEY | 0x0a,
  SYSREQ = SPKEY | 0x0b,
  CLEAR = SPKEY | 0x0c,
  HOME = SPKEY | 0x0d,
  END = SPKEY | 0x0e,
  LEFT = SPKEY | 0x0f,
  UP = SPKEY | 0x10,
  RIGHT = SPKEY | 0x11,
  DOWN = SPKEY | 0x12,
  PAGEUP = SPKEY | 0x13,
  PAGEDOWN = SPKEY | 0x14,
  SHIFT = SPKEY | 0x15,
  CTRL = SPKEY | 0x16,
  META = SPKEY | 0x17,
  ALT = SPKEY | 0x18,
  CAPSLOCK = SPKEY | 0x19,
  NUMLOCK = SPKEY | 0x1a,
  SCROLLLOCK = SPKEY | 0x1b,

  F1 = SPKEY | 0x1c,
  F2 = SPKEY | 0x1d,
  F3 = SPKEY | 0x1e,
  F4 = SPKEY | 0x1f,
  F5 = SPKEY | 0x20,
  F6 = SPKEY | 0x21,
  F7 = SPKEY | 0x22,
  F8 = SPKEY | 0x23,
  F9 = SPKEY | 0x24,
  F10 = SPKEY | 0x25,
  F11 = SPKEY | 0x26,
  F12 = SPKEY | 0x27,
  F13 = SPKEY | 0x28,
  F14 = SPKEY | 0x29,
  F15 = SPKEY | 0x2a,
  F16 = SPKEY | 0x2b,
  F17 = SPKEY | 0x2c,
  F18 = SPKEY | 0x2d,
  F19 = SPKEY | 0x2e,
  F20 = SPKEY | 0x2f,
  F21 = SPKEY | 0x30,
  F22 = SPKEY | 0x31,
  F23 = SPKEY | 0x32,
  F24 = SPKEY | 0x33,
  F25 = SPKEY | 0x34,
  F26 = SPKEY | 0x35,
  F27 = SPKEY | 0x36,
  F28 = SPKEY | 0x37,
  F29 = SPKEY | 0x38,
  F30 = SPKEY | 0x39,
  F31 = SPKEY | 0x3a,
  F32 = SPKEY | 0x3b,
  F33 = SPKEY | 0x3c,
  F34 = SPKEY | 0x3d,
  F35 = SPKEY | 0x3e,

  MENU = SPKEY | 0x42,
  HYPER = SPKEY | 0x43,
  HELP = SPKEY | 0x45,
  BACK = SPKEY | 0x48,
  FORWARD = SPKEY | 0x49,
  STOP = SPKEY | 0x4a,
  REFRESH = SPKEY | 0x4b,
  VOLUMEDOWN = SPKEY | 0x4c,
  VOLUMEMUTE = SPKEY | 0x4d,
  VOLUMEUP = SPKEY | 0x4e,
  MEDIAPLAY = SPKEY | 0x54,
  MEDIASTOP = SPKEY | 0x55,
  MEDIAPREVIOUS = SPKEY | 0x56,
  MEDIANEXT = SPKEY | 0x57,
  MEDIARECORD = SPKEY | 0x58,
  HOMEPAGE = SPKEY | 0x59,
  FAVORITES = SPKEY | 0x5a,
  SEARCH = SPKEY | 0x5b,
  STANDBY = SPKEY | 0x5c,
  OPENURL = SPKEY | 0x5d,
  LAUNCHMAIL = SPKEY | 0x5e,
  LAUNCHMEDIA = SPKEY | 0x5f,

  LAUNCH_0 = SPKEY | 0x60,
  LAUNCH_1 = SPKEY | 0x61,
  LAUNCH_2 = SPKEY | 0x62,
  LAUNCH_3 = SPKEY | 0x63,
  LAUNCH_4 = SPKEY | 0x64,
  LAUNCH_5 = SPKEY | 0x65,
  LAUNCH_6 = SPKEY | 0x66,
  LAUNCH_7 = SPKEY | 0x67,
  LAUNCH_8 = SPKEY | 0x68,
  LAUNCH_9 = SPKEY | 0x69,
  LAUNCH_A = SPKEY | 0x6a,
  LAUNCH_B = SPKEY | 0x6b,
  LAUNCH_C = SPKEY | 0x6c,
  LAUNCH_D = SPKEY | 0x6d,
  LAUNCH_E = SPKEY | 0x6e,
  LAUNCH_F = SPKEY | 0x6f,

  GLOBE = SPKEY | 0x70,
  KEYBOARD = SPKEY | 0x71,
  JIS_EISU = SPKEY | 0x72,
  JIS_KANA = SPKEY | 0x73,

  // ---- 小键盘 ----
  KP_MULTIPLY = SPKEY | 0x81,
  KP_DIVIDE = SPKEY | 0x82,
  KP_SUBTRACT = SPKEY | 0x83,
  KP_PERIOD = SPKEY | 0x84,
  KP_ADD = SPKEY | 0x85,
  KP_0 = SPKEY | 0x86,
  KP_1 = SPKEY | 0x87,
  KP_2 = SPKEY | 0x88,
  KP_3 = SPKEY | 0x89,
  KP_4 = SPKEY | 0x8a,
  KP_5 = SPKEY | 0x8b,
  KP_6 = SPKEY | 0x8c,
  KP_7 = SPKEY | 0x8d,
  KP_8 = SPKEY | 0x8e,
  KP_9 = SPKEY | 0x8f,
}

/** 鼠标按键，对应 Godot 的 `MouseButton`。 */
export enum MouseButton {
  NONE = 0,
  LEFT = 1,
  RIGHT = 2,
  MIDDLE = 3,
  WHEEL_UP = 4,
  WHEEL_DOWN = 5,
  WHEEL_LEFT = 6,
  WHEEL_RIGHT = 7,
  XBUTTON1 = 8,
  XBUTTON2 = 9,
}

/** 鼠标按键掩码，对应 Godot 的 `MouseButtonMask`。 */
export enum MouseButtonMask {
  LEFT = 1 << 0,
  RIGHT = 1 << 1,
  MIDDLE = 1 << 2,
  MB_XBUTTON1 = 1 << 3,
  MB_XBUTTON2 = 1 << 4,
}

/** 手柄按键，对应 Godot 的 `JoyButton`。 */
export enum JoyButton {
  A = 0,
  B = 1,
  X = 2,
  Y = 3,
  BACK = 4,
  GUIDE = 5,
  START = 6,
  LEFT_STICK = 7,
  RIGHT_STICK = 8,
  LEFT_SHOULDER = 9,
  RIGHT_SHOULDER = 10,
  DPAD_UP = 11,
  DPAD_DOWN = 12,
  DPAD_LEFT = 13,
  DPAD_RIGHT = 14,
  MAX = 15,
  INVALID = -1,
}

/** 手柄轴，对应 Godot 的 `JoyAxis`。 */
export enum JoyAxis {
  LEFT_X = 0,
  LEFT_Y = 1,
  RIGHT_X = 2,
  RIGHT_Y = 3,
  TRIGGER_LEFT = 4,
  TRIGGER_RIGHT = 5,
  MAX = 6,
  INVALID = -1,
}

/** 鼠标模式，对应 Godot 的 `Input.MouseMode`。 */
export enum MouseMode {
  VISIBLE = 0,
  HIDDEN = 1,
  CAPTURED = 2,
  CONFINED = 3,
  CONFINED_HIDDEN = 4,
}

/** 鼠标光标形状，对应 Godot 的 `Input.CursorShape`。 */
export enum CursorShape {
  ARROW = 0,
  IBEAM = 1,
  POINTING_HAND = 2,
  CROSS = 3,
  WAIT = 4,
  BUSY = 5,
  DRAG = 6,
  CAN_DROP = 7,
  FORBIDDEN = 8,
  VSIZE = 9,
  HSIZE = 10,
  BDIAGSIZE = 11,
  FDIAGSIZE = 12,
  MOVE = 13,
  VSPLIT = 14,
  HSPLIT = 15,
  HELP = 16,
  MAX = 17,
}

/** `input_event.type` 的判别值，用于 JSON 序列化与编辑器下拉框。 */
export enum InputEventType {
  NONE = "none",
  KEY = "key",
  MOUSE_BUTTON = "mouse_button",
  MOUSE_MOTION = "mouse_motion",
  JOY_BUTTON = "joypad_button",
  JOY_MOTION = "joypad_motion",
  ACTION = "action",
  SCREEN_TOUCH = "screen_touch",
  SCREEN_DRAG = "screen_drag",
}

/** 判断一个按键码是否为 Godot 定义的“功能键/特殊键”。 */
export function isSpecialKey(key: Key): boolean {
  return (key & SPKEY) !== 0 && key !== 0;
}

/* ------------------------------------------------------------------------ */
/*                          按键名 / 显示名相关                              */
/* ------------------------------------------------------------------------ */

/** Godot `Key` -> 人类可读名字（`OS.get_keycode_string()` 的等价物）。 */
const KEY_DISPLAY_NAMES: Record<number, string> = {
  [Key.NONE]: "None",
  [Key.UNKNOWN]: "Unknown",
  [Key.SPACE]: "Space",
  [Key.EXCLAM]: "!",
  [Key.QUOTEDBL]: '"',
  [Key.NUMBERSIGN]: "#",
  [Key.DOLLAR]: "$",
  [Key.PERCENT]: "%",
  [Key.AMPERSAND]: "&",
  [Key.APOSTROPHE]: "'",
  [Key.PARENLEFT]: "(",
  [Key.PARENRIGHT]: ")",
  [Key.ASTERISK]: "*",
  [Key.PLUS]: "+",
  [Key.COMMA]: ",",
  [Key.MINUS]: "-",
  [Key.PERIOD]: ".",
  [Key.SLASH]: "/",
  [Key.COLON]: ":",
  [Key.SEMICOLON]: ";",
  [Key.LESS]: "<",
  [Key.EQUAL]: "=",
  [Key.GREATER]: ">",
  [Key.QUESTION]: "?",
  [Key.AT]: "@",
  [Key.BRACKETLEFT]: "[",
  [Key.BACKSLASH]: "\\",
  [Key.BRACKETRIGHT]: "]",
  [Key.ASCIICIRCUM]: "^",
  [Key.UNDERSCORE]: "_",
  [Key.QUOTELEFT]: "`",
  [Key.BRACELEFT]: "{",
  [Key.BAR]: "|",
  [Key.BRACERIGHT]: "}",
  [Key.ASCIITILDE]: "~",
  [Key.ESCAPE]: "Escape",
  [Key.TAB]: "Tab",
  [Key.BACKTAB]: "Shift+Tab",
  [Key.BACKSPACE]: "Backspace",
  [Key.ENTER]: "Enter",
  [Key.KP_ENTER]: "Keypad Enter",
  [Key.INSERT]: "Insert",
  [Key.DELETE]: "Delete",
  [Key.PAUSE]: "Pause",
  [Key.PRINT]: "Print Screen",
  [Key.SYSREQ]: "SysReq",
  [Key.CLEAR]: "Clear",
  [Key.HOME]: "Home",
  [Key.END]: "End",
  [Key.LEFT]: "Left",
  [Key.UP]: "Up",
  [Key.RIGHT]: "Right",
  [Key.DOWN]: "Down",
  [Key.PAGEUP]: "Page Up",
  [Key.PAGEDOWN]: "Page Down",
  [Key.SHIFT]: "Shift",
  [Key.CTRL]: "Ctrl",
  [Key.META]: "Meta",
  [Key.ALT]: "Alt",
  [Key.CAPSLOCK]: "Caps Lock",
  [Key.NUMLOCK]: "Num Lock",
  [Key.SCROLLLOCK]: "Scroll Lock",
  [Key.MENU]: "Menu",
  [Key.HYPER]: "Hyper",
  [Key.HELP]: "Help",
  [Key.BACK]: "Back",
  [Key.FORWARD]: "Forward",
  [Key.STOP]: "Stop",
  [Key.REFRESH]: "Refresh",
  [Key.VOLUMEDOWN]: "Volume Down",
  [Key.VOLUMEMUTE]: "Volume Mute",
  [Key.VOLUMEUP]: "Volume Up",
  [Key.MEDIAPLAY]: "Media Play",
  [Key.MEDIASTOP]: "Media Stop",
  [Key.MEDIAPREVIOUS]: "Media Previous",
  [Key.MEDIANEXT]: "Media Next",
  [Key.MEDIARECORD]: "Media Record",
  [Key.HOMEPAGE]: "Home Page",
  [Key.FAVORITES]: "Favorites",
  [Key.SEARCH]: "Search",
  [Key.STANDBY]: "Standby",
  [Key.OPENURL]: "Open URL",
  [Key.LAUNCHMAIL]: "Launch Mail",
  [Key.LAUNCHMEDIA]: "Launch Media",
  [Key.GLOBE]: "Globe",
  [Key.KEYBOARD]: "Keyboard",
  [Key.JIS_EISU]: "Eisu",
  [Key.JIS_KANA]: "Kana",
  [Key.KP_MULTIPLY]: "Keypad *",
  [Key.KP_DIVIDE]: "Keypad /",
  [Key.KP_SUBTRACT]: "Keypad -",
  [Key.KP_PERIOD]: "Keypad .",
  [Key.KP_ADD]: "Keypad +",
  [Key.SECTION]: "Section",
  [Key.YEN]: "Yen",
};

// 批量补齐字母、数字、F 键、小键盘数字的显示名。
for (let i = 0; i < 26; i++) {
  KEY_DISPLAY_NAMES[Key.A + i] = String.fromCharCode(65 + i);
}
for (let i = 0; i < 10; i++) {
  KEY_DISPLAY_NAMES[Key.NUM_0 + i] = String(i);
  KEY_DISPLAY_NAMES[Key.KP_0 + i] = `Keypad ${i}`;
}
for (let i = 0; i < 35; i++) {
  KEY_DISPLAY_NAMES[Key.F1 + i] = `F${i + 1}`;
}

/** 把 Godot `Key` 转成人类可读的名字，等价于 Godot 的 `OS.get_keycode_string()`。 */
export function keyToString(key: Key): string {
  if (key === undefined || key === null) return "None";
  const name = KEY_DISPLAY_NAMES[key];
  if (name !== undefined) return name;
  if (key >= 32 && key <= 126) return String.fromCharCode(key);
  return `0x${key.toString(16).toUpperCase()}`;
}

/** `keyToString` 的逆运算；无法解析时返回 `Key.NONE`。 */
export function stringToKey(name: string): Key {
  if (!name) return Key.NONE;
  const trimmed = name.trim();
  for (const k of Object.keys(KEY_DISPLAY_NAMES)) {
    if (KEY_DISPLAY_NAMES[<any>k as number] === trimmed) return Number(k) as Key;
  }
  if (trimmed.length === 1) {
    const c = trimmed.charCodeAt(0);
    if (c >= 32 && c <= 126) return c as Key;
  }
  return Key.NONE;
}

/* ------------------------------------------------------------------------ */
/*                       浏览器 DOM 事件的键 -> Godot Key                    */
/* ------------------------------------------------------------------------ */

/**
 * `KeyboardEvent.code`（物理按键）-> Godot `Key`。
 * 用于 `Input.isPhysicalKeyPressed()` 与 `InputEventKey.physicalKeycode`。
 */
export const KEY_FROM_CODE: Readonly<Record<string, Key>> = {
  Escape: Key.ESCAPE,
  Tab: Key.TAB,
  CapsLock: Key.CAPSLOCK,
  Backspace: Key.BACKSPACE,
  Enter: Key.ENTER,
  NumpadEnter: Key.KP_ENTER,
  Insert: Key.INSERT,
  Delete: Key.DELETE,
  Home: Key.HOME,
  End: Key.END,
  PageUp: Key.PAGEUP,
  PageDown: Key.PAGEDOWN,
  ArrowLeft: Key.LEFT,
  ArrowUp: Key.UP,
  ArrowRight: Key.RIGHT,
  ArrowDown: Key.DOWN,
  ShiftLeft: Key.SHIFT,
  ShiftRight: Key.SHIFT,
  ControlLeft: Key.CTRL,
  ControlRight: Key.CTRL,
  AltLeft: Key.ALT,
  AltRight: Key.ALT,
  MetaLeft: Key.META,
  MetaRight: Key.META,
  NumLock: Key.NUMLOCK,
  ScrollLock: Key.SCROLLLOCK,
  PrintScreen: Key.PRINT,
  Pause: Key.PAUSE,
  ContextMenu: Key.MENU,
  Space: Key.SPACE,

  Minus: Key.MINUS,
  Equal: Key.EQUAL,
  BracketLeft: Key.BRACKETLEFT,
  BracketRight: Key.BRACKETRIGHT,
  Backslash: Key.BACKSLASH,
  Semicolon: Key.SEMICOLON,
  Quote: Key.APOSTROPHE,
  Backquote: Key.QUOTELEFT,
  Comma: Key.COMMA,
  Period: Key.PERIOD,
  Slash: Key.SLASH,
  IntlBackslash: Key.BACKSLASH,
  IntlYen: Key.YEN,
  IntlRo: Key.UNDERSCORE,

  NumpadMultiply: Key.KP_MULTIPLY,
  NumpadDivide: Key.KP_DIVIDE,
  NumpadSubtract: Key.KP_SUBTRACT,
  NumpadAdd: Key.KP_ADD,
  NumpadDecimal: Key.KP_PERIOD,
};

// KeyA ~ KeyZ、Digit0 ~ Digit9、Numpad0 ~ Numpad9、F1 ~ F12 按规律补齐。
for (let i = 0; i < 26; i++) {
  (KEY_FROM_CODE as Record<string, Key>)[`Key${String.fromCharCode(65 + i)}`] = Key.A + i;
}
for (let i = 0; i < 10; i++) {
  (KEY_FROM_CODE as Record<string, Key>)[`Digit${i}`] = Key.NUM_0 + i;
  (KEY_FROM_CODE as Record<string, Key>)[`Numpad${i}`] = Key.KP_0 + i;
}
for (let i = 0; i < 12; i++) {
  (KEY_FROM_CODE as Record<string, Key>)[`F${i + 1}`] = Key.F1 + i;
}

/**
 * `KeyboardEvent.key`（逻辑按键）-> Godot `Key`。
 * 用于 `Input.isKeyPressed()` 与 `InputEventKey.keycode`。
 */
export const KEY_FROM_KEY: Readonly<Record<string, Key>> = {
  Escape: Key.ESCAPE,
  Tab: Key.TAB,
  CapsLock: Key.CAPSLOCK,
  Backspace: Key.BACKSPACE,
  Enter: Key.ENTER,
  Insert: Key.INSERT,
  Delete: Key.DELETE,
  Home: Key.HOME,
  End: Key.END,
  PageUp: Key.PAGEUP,
  PageDown: Key.PAGEDOWN,
  ArrowLeft: Key.LEFT,
  ArrowUp: Key.UP,
  ArrowRight: Key.RIGHT,
  ArrowDown: Key.DOWN,
  Shift: Key.SHIFT,
  Control: Key.CTRL,
  Alt: Key.ALT,
  Meta: Key.META,
  NumLock: Key.NUMLOCK,
  ScrollLock: Key.SCROLLLOCK,
  PrintScreen: Key.PRINT,
  Pause: Key.PAUSE,
  ContextMenu: Key.MENU,
  " ": Key.SPACE,
  "!": Key.EXCLAM,
  '"': Key.QUOTEDBL,
  "#": Key.NUMBERSIGN,
  $: Key.DOLLAR,
  "%": Key.PERCENT,
  "&": Key.AMPERSAND,
  "'": Key.APOSTROPHE,
  "(": Key.PARENLEFT,
  ")": Key.PARENRIGHT,
  "*": Key.ASTERISK,
  "+": Key.PLUS,
  ",": Key.COMMA,
  "-": Key.MINUS,
  ".": Key.PERIOD,
  "/": Key.SLASH,
  ":": Key.COLON,
  ";": Key.SEMICOLON,
  "<": Key.LESS,
  "=": Key.EQUAL,
  ">": Key.GREATER,
  "?": Key.QUESTION,
  "@": Key.AT,
  "[": Key.BRACKETLEFT,
  "\\": Key.BACKSLASH,
  "]": Key.BRACKETRIGHT,
  "^": Key.ASCIICIRCUM,
  _: Key.UNDERSCORE,
  "`": Key.QUOTELEFT,
  "{": Key.BRACELEFT,
  "|": Key.BAR,
  "}": Key.BRACERIGHT,
  "~": Key.ASCIITILDE,
  "¥": Key.YEN,
  "§": Key.SECTION,
};

// 用 charCode 归一化可打印 ASCII（字母统一处理大小写）。
export function keyFromDomKey(rawKey: string): Key {
  if (!rawKey) return Key.NONE;
  const mapped = KEY_FROM_KEY[rawKey];
  if (mapped !== undefined) return mapped;
  if (rawKey.length === 1) {
    const c = rawKey.toUpperCase().charCodeAt(0);
    if (c >= 32 && c <= 126) return c as Key;
  }
  return Key.NONE;
}

/** 由浏览器物理键码 `KeyboardEvent.code` 得到 Godot `Key`。 */
export function keyFromDomCode(code: string): Key {
  if (!code) return Key.NONE;
  const mapped = KEY_FROM_CODE[code];
  return mapped !== undefined ? mapped : Key.NONE;
}

/* ------------------------------------------------------------------------ */
/*                       手柄轴 / 按钮 的字符串互转                          */
/* ------------------------------------------------------------------------ */

const JOY_AXIS_NAMES: readonly string[] = [
  "Left X",
  "Left Y",
  "Right X",
  "Right Y",
  "Trigger Left",
  "Trigger Right",
];

const JOY_BUTTON_NAMES: readonly string[] = [
  "A",
  "B",
  "X",
  "Y",
  "Back",
  "Guide",
  "Start",
  "Left Stick",
  "Right Stick",
  "Left Shoulder",
  "Right Shoulder",
  "D-Pad Up",
  "D-Pad Down",
  "D-Pad Left",
  "D-Pad Right",
];

/** 手柄轴英文标识（Godot 的 `Input.get_joy_axis_string()` 返回值）。 */
const JOY_AXIS_STRINGS: readonly string[] = [
  "left_x",
  "left_y",
  "right_x",
  "right_y",
  "trigger_left",
  "trigger_right",
];

/** 手柄按键英文标识（Godot 的 `Input.get_joy_button_string()` 返回值）。 */
const JOY_BUTTON_STRINGS: readonly string[] = [
  "a",
  "b",
  "x",
  "y",
  "back",
  "guide",
  "start",
  "left_stick",
  "right_stick",
  "left_shoulder",
  "right_shoulder",
  "dpad_up",
  "dpad_down",
  "dpad_left",
  "dpad_right",
];

/** 等价于 Godot 的 `Input.get_joy_axis_string()`。 */
export function joyAxisToString(axis: JoyAxis): string {
  return JOY_AXIS_STRINGS[axis] ?? "invalid";
}

/** 等价于 Godot 的 `Input.get_joy_axis_index_from_string()`。 */
export function joyAxisFromString(name: string): JoyAxis {
  const index = JOY_AXIS_STRINGS.indexOf(name);
  return index >= 0 ? (index as JoyAxis) : JoyAxis.INVALID;
}

/** 等价于 Godot 的 `Input.get_joy_button_string()`。 */
export function joyButtonToString(button: JoyButton): string {
  return JOY_BUTTON_STRINGS[button] ?? "invalid";
}

/** 等价于 Godot 的 `Input.get_joy_button_index_from_string()`。 */
export function joyButtonFromString(name: string): JoyButton {
  const index = JOY_BUTTON_STRINGS.indexOf(name);
  return index >= 0 ? (index as JoyButton) : JoyButton.INVALID;
}

/** 手柄轴的人类可读名字，供编辑器扩展的下拉框使用。 */
export function joyAxisToDisplayName(axis: JoyAxis): string {
  return JOY_AXIS_NAMES[axis] ?? "Invalid";
}

/** 手柄按键的人类可读名字，供编辑器扩展的下拉框使用。 */
export function joyButtonToDisplayName(button: JoyButton): string {
  return JOY_BUTTON_NAMES[button] ?? "Invalid";
}

/* ------------------------------------------------------------------------ */
/*                            鼠标 / 光标相关                                */
/* ------------------------------------------------------------------------ */

/** 鼠标按键的人类可读名字。 */
export function mouseButtonToString(button: MouseButton): string {
  switch (button) {
    case MouseButton.LEFT:
      return "Left";
    case MouseButton.RIGHT:
      return "Right";
    case MouseButton.MIDDLE:
      return "Middle";
    case MouseButton.WHEEL_UP:
      return "Wheel Up";
    case MouseButton.WHEEL_DOWN:
      return "Wheel Down";
    case MouseButton.WHEEL_LEFT:
      return "Wheel Left";
    case MouseButton.WHEEL_RIGHT:
      return "Wheel Right";
    case MouseButton.XBUTTON1:
      return "XButton 1";
    case MouseButton.XBUTTON2:
      return "XButton 2";
    default:
      return "None";
  }
}

/** 把 `Gamepad` 的按钮索引映射为 Godot 的 `JoyButton`（标准布局）。 */
export function joyButtonFromGamepadIndex(index: number): JoyButton {
  return index >= 0 && index < JoyButton.MAX ? (index as JoyButton) : JoyButton.INVALID;
}

/** 把 `Gamepad` 的轴索引映射为 Godot 的 `JoyAxis`（标准布局）。 */
export function joyAxisFromGamepadIndex(index: number): JoyAxis {
  return index >= 0 && index < JoyAxis.MAX ? (index as JoyAxis) : JoyAxis.INVALID;
}

/** `CursorShape` -> CSS `cursor` 值。 */
export function cursorShapeToCss(shape: CursorShape): string {
  switch (shape) {
    case CursorShape.IBEAM:
      return "text";
    case CursorShape.POINTING_HAND:
      return "pointer";
    case CursorShape.CROSS:
      return "crosshair";
    case CursorShape.WAIT:
      return "wait";
    case CursorShape.BUSY:
      return "progress";
    case CursorShape.DRAG:
      return "grab";
    case CursorShape.CAN_DROP:
      return "copy";
    case CursorShape.FORBIDDEN:
      return "not-allowed";
    case CursorShape.VSIZE:
      return "ns-resize";
    case CursorShape.HSIZE:
      return "ew-resize";
    case CursorShape.BDIAGSIZE:
      return "nesw-resize";
    case CursorShape.FDIAGSIZE:
      return "nwse-resize";
    case CursorShape.MOVE:
      return "move";
    case CursorShape.VSPLIT:
      return "row-resize";
    case CursorShape.HSPLIT:
      return "col-resize";
    case CursorShape.HELP:
      return "help";
    default:
      return "default";
  }
}
