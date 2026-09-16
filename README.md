# laya-input

把 **Godot 4.x 的输入系统**（`Input` / `InputMap` / `InputEvent` 家族）移植到 **LayaAir** 运行时的 TypeScript 库。

API 名称、枚举取值、函数语义都尽量与 Godot 保持一致，因此从 GDScript 项目迁移过来的输入逻辑，通常只需要把 `snake_case` 改成 `camelCase` 即可直接使用。

```ts
import { Input } from "laya-input";

if (Input.isActionJustPressed("jump")) {
  // 跳跃
}
const dir = Input.getVector("move_left", "move_right", "move_up", "move_down");
```

## 特性

- 覆盖 Godot `Input` 类的全部常用接口：动作、轴 / 向量、键盘、鼠标、手柄、传感器、鼠标模式与光标、震动、IME。
- 枚举取值与 Godot 完全一致（`Key` 的 ASCII / `SPKEY` 编码、`MouseButton`、`JoyButton`、`JoyAxis`、`MouseMode`、`CursorShape`）。
- 动作映射从 JSON 载入，格式与仓库内的**输入映射编辑器扩展**（`LayaProject/src/editor`）配套。
- 输入帧语义：`just_pressed` / `just_released` 保证**不会漏、不会重复上报**。
- 监听自动安装、可自愈（引擎还没就绪时会自动重试），且可随时 `uninstall()`。
- 不依赖 Laya 运行时的纯逻辑部分（枚举、事件、`InputMap`）可安全地在 IDE 扩展里引用。

## 安装

```bash
npm install laya-input
# 或
pnpm add laya-input
```

## 快速开始

### 1. 直接用 `Input` 查询

首次调用任意查询接口时会**自动安装**监听与帧循环（`Input.install()`），不需要手动初始化。

```ts
import { Input, Key, MouseButton } from "laya-input";

export class Player extends Laya.Script {
  onUpdate(): void {
    // 动作
    if (Input.isActionJustPressed("jump")) this.jump();
    if (Input.isActionPressed("fire")) this.fire(Input.getActionStrength("fire"));

    // 轴与二维向量
    const move = Input.getVector("move_left", "move_right", "move_up", "move_down");
    const throttle = Input.getAxis("brake", "accelerate");

    // 键盘 / 鼠标原始状态
    if (Input.isKeyPressed(Key.ESCAPE)) this.pause();
    if (Input.isPhysicalKeyPressed(Key.W)) this.forward();
    if (Input.isMouseButtonPressed(MouseButton.LEFT)) this.shoot();
  }
}
```

### 2. 准备输入映射（`inputmap.json`）

动作名必须在 `InputMap` 里存在，否则查询恒为 `false`（并只会在控制台提示一次）。

- 默认资源路径：`resources/inputmap.json`（常量 `DEFAULT_INPUT_MAP_PATH`）。
- `Input.install()` 会自动通过 `Laya.loader` 载入该文件，无需手动 `await`。
- 想确认是否已载入：`await InputMap.singleton.ready;`

如果映射文件不在默认位置：

```ts
import { Input, InputMap } from "laya-input";

// 必须在第一次使用 Input 之前设置
InputMap.defaultFile = "assets/config/my_inputmap.json";

// 或者自己载入（非 Laya 环境 / 只想用 fetch 时）
await InputMap.loadFromFile("assets/config/my_inputmap.json");
```

用代码手工建表同样可以：

```ts
import { Input, InputMap, InputEventKey, InputEventJoypadMotion, JoyAxis, Key } from "laya-input";

const map = InputMap.singleton;
map.addAction("jump", 0.2);
map.actionAddEvent("jump", Object.assign(new InputEventKey(), { keycode: Key.SPACE }));

const stick = new InputEventJoypadMotion();
stick.axis = JoyAxis.LEFT_Y;
stick.axisValue = -1; // 摇杆向上
map.actionAddEvent("jump", stick);
```

## 输入帧与 `just_pressed` 语义

这是本库和 Godot 最容易产生疑问的部分，单独说明。

- 「输入帧」= 一次结算。默认由 `Laya.timer.frameLoop` 每帧调用 `Input.update()` 驱动（`Input.autoFrameUpdate = true`）。
- 边沿（`isActionJustPressed` / `isActionJustReleased`）在**事件落地的那一刻**就生效，不依赖下一次 `update()`，因此事件所在的那一帧查询一定能拿到 `true`。
- 边沿分三层保存，保证：同帧内多次查询结果一致；每个边沿只上报一次；某一帧没有任何脚本查询时，边沿会保留到下一帧补读一次，避免掉帧吞按键。
- 因此不管 `Input.update()` 与你的游戏逻辑在同一引擎帧里谁先谁后，按键都不会被漏掉。
- 即使没人调用 `Input.update()`（不是靠帧循环、只在 `onUpdate` 里轮询），边沿也会惰性推进，不会永远卡在 `true`。

自定义结算时机：

```ts
Input.setAutoFrameUpdate(false); // 关掉内置帧循环
// 然后在脚本里自己结算
onLateUpdate(): void {
  Input.update();
}
```

> 注意：关掉自动帧循环后，手柄轴这类「没有明显边沿」的输入必须靠手动 `Input.update()` 刷新。

## API 速查

所有成员均为静态，直接 `Input.xxx()` 调用。下表中的「Godot 等价」指对应的 GDScript 接口。

### 安装与调试

| 方法 | 说明 | Godot 等价 |
| --- | --- | --- |
| `Input.install()` | 安装全局监听（首次查询会自动调用） | — |
| `Input.uninstall()` | 卸载监听并清空全部状态 | — |
| `Input.installed` | 是否有监听已安装 | — |
| `Input.update()` | 手动结算一帧 | — |
| `Input.setAutoFrameUpdate(enable)` / `Input.autoFrameUpdate` | 开关内置帧循环 | — |
| `Input.getDebugInfo()` | 返回监听 / 引擎 / 动作数量等排查信息 | — |

读不到输入时先打印 `Input.getDebugInfo()`：`keyboardListeners`、`stageListeners`、`frameLoop` 为 `false`，或 `actions` 为 `0`，基本就能定位问题。

### 动作（Action）

| 方法 | 说明 |
| --- | --- |
| `isActionPressed(action, exactMatch?, allowEcho?)` | 动作当前是否按下 |
| `isActionJustPressed(action, exactMatch?)` | 本输入帧是否刚按下 |
| `isActionJustReleased(action, exactMatch?)` | 本输入帧是否刚抬起 |
| `isActionJustPressedByEvent(action, event, exactMatch?)` | 指定事件是否会让动作「刚按下」 |
| `isActionJustReleasedByEvent(action, event, exactMatch?)` | 指定事件是否会让动作「刚抬起」 |
| `getActionStrength(action, exactMatch?)` | 归一化强度（应用死区），0 ~ 1 |
| `getActionRawStrength(action, exactMatch?)` | 原始强度（未归一化） |
| `getAxis(negativeAction, positiveAction)` | 一维轴值 = 正向 − 负向 |
| `getVector(negativeX, positiveX, negativeY, positiveY, deadzone?)` | 二维向量（`deadzone < 0` 时自动取四个动作死区最大值） |
| `actionPress(action, strength?)` | 用代码强制按下动作 |
| `actionRelease(action)` | 用代码强制抬起动作 |
| `setAxis(negativeAction, positiveAction, axisValue)` | 用代码设置一维轴 |
| `releaseAllInputs()` | 清空所有按键 / 鼠标 / 手柄 / 虚拟动作状态 |

`actionPress()` / `actionRelease()` 会立即结算，因此同一调用栈内 `isActionPressed()` / `isActionJustPressed()` 结果是一致的。

### 键盘

| 方法 | 说明 |
| --- | --- |
| `isKeyPressed(keycode)` | 逻辑键是否按下（受键盘布局影响，对应 `KeyboardEvent.key`） |
| `isPhysicalKeyPressed(keycode)` | 物理键是否按下（对应 `KeyboardEvent.code`） |
| `isAnythingPressed()` | 键盘 / 鼠标 / 手柄 / 动作是否有任意输入被按下 |

### 鼠标与光标

| 方法 | 说明 |
| --- | --- |
| `isMouseButtonPressed(button)` | 鼠标按键是否按下 |
| `getMouseButtonMask()` | 鼠标按键掩码 |
| `getMousePosition()` | 舞台坐标系位置 |
| `getMouseScreenPosition()` | 屏幕（画布）坐标系位置（Web 端与上者相同） |
| `getLastMouseVelocity()` / `getLastMouseScreenVelocity()` | 上一帧鼠标速度（像素 / 秒） |
| `getMouseMode()` / `setMouseMode(mode)` | 读取 / 设置鼠标模式（`VISIBLE` / `HIDDEN` / `CAPTURED` / `CONFINED` / `CONFINED_HIDDEN`） |
| `warpMouse(position)` | 移动鼠标逻辑位置（浏览器只能影响捕获模式下） |
| `setDefaultCursorShape(shape)` / `getCurrentCursorShape()` | 设置 / 读取光标形状 |
| `setCustomMouseCursor(url, shape?, hotspot?)` | 设置自定义光标，`url` 需为浏览器可直接加载的地址（data URL / blob URL / 站点内图片），传 `null` 清除 |
| `isEmulatingMouseFromTouch()` / `setEmulateMouseFromTouch(enable)` | 触摸模拟鼠标 |
| `isEmulatingTouchFromMouse()` / `setEmulateTouchFromMouse(enable)` | 鼠标模拟触摸 |
| `isIgnoringKeysInTextInput()` / `setIgnoreKeysInTextInput(enable)` | 焦点在**可见**的 HTML 输入框里时是否忽略键盘（默认 `true`） |

`setMouseMode(CAPTURED)` 内部会调用 `canvas.requestPointerLock()`；隐藏输入控件（引擎自己用来接收键盘的那种）不会被误判成「正在打字」。

### 事件派发与缓冲

| 方法 | 说明 |
| --- | --- |
| `parseInputEvent(event)` | 手动派发一个输入事件，使其参与动作匹配 |
| `flushBufferedEvents()` | 清空事件缓冲 |
| `isUsingAccumulatedInput()` / `setUseAccumulatedInput(enable)` | 是否累积输入；关闭时会顺带清空缓冲 |

### 手柄（Gamepad）

| 方法 | 说明 |
| --- | --- |
| `getConnectedJoypads()` | 已连接的手柄设备 ID 列表 |
| `getJoyName(device)` / `getJoyGuid(device)` / `getJoyInfo(device)` | 名称 / GUID / 信息字典 |
| `getJoyAxis(device, axis)` / `isJoyButtonPressed(device, button)` | 轴值 / 按键状态 |
| `getJoyAxisIndexFromString(name)` / `getJoyAxisString(axis)` | 轴名 ↔ `JoyAxis` |
| `getJoyButtonIndexFromString(name)` / `getJoyButtonString(button)` | 按键名 ↔ `JoyButton` |
| `isJoyKnown(device)` | 手柄是否被识别 |
| `hasJoyVibration(device)` / `isJoyVibrationSupported(device)` | 是否支持震动 |
| `startJoyVibration(device, weak, strong, duration?)` | 开始震动，`duration` 单位为**秒** |
| `stopJoyVibration(device)` | 停止震动 |
| `isJoyVibrating(device)` / `getJoyVibrationDuration(device)` / `getJoyVibrationRemainingDuration(device)` / `getJoyVibrationStrength(device)` | 震动状态查询 |
| `vibrateHandheld(durationMs?, amplitude?)` | 移动端整体震动（基于 Vibration API，`amplitude` 被忽略） |
| `addJoyMapping(mapping, updateExisting?)` / `removeJoyMapping(guid)` / `getJoyMappings()` | SDL 风格映射字符串，仅记录，不影响真实 Gamepad（浏览器不允许替换映射） |
| `onJoyConnectionChanged(cb)` / `offJoyConnectionChanged(cb)` | 手柄连接变化回调，等价于 `joy_connection_changed` 信号 |
| `isIgnoringJoypad()` / `setIgnoringJoypad(enable)` | 是否忽略手柄输入 |
| `isIgnoreJoypadOnUnfocused()` / `setIgnoreJoypadOnUnfocused(enable)` | 窗口失焦时是否忽略手柄（默认 `true`） |

手柄通过 **Web Gamepad API 每帧轮询**实现（等价于 Godot 的 SDL 手柄）：按键边沿与轴变化会转成 `InputEventJoypadButton` / `InputEventJoypadMotion` 派发进动作系统。摇杆带 `0.08` 的硬件死区；扳机轴会从浏览器的 `0 ~ 1` 换算成 Godot 的 `-1 ~ 1`。

### 设备传感器

| 方法 | 说明 |
| --- | --- |
| `getGravity()` / `setGravity(v)` | 重力向量（m/s²） |
| `getAccelerometer()` / `setAccelerometer(v)` | 加速度计向量 |
| `getGyroscope()` / `setGyroscope(v)` | 陀螺仪向量 |
| `getMagnetometer()` / `setMagnetometer(v)` | 磁力计 |
| `getDeviceOrientation()` / `setDeviceOrientation(q)` | 设备朝向四元数 |

基于 `devicemotion` / `deviceorientation`，首次查询时自动绑定。浏览器没有磁力计数据源，`getMagnetometer()` 需自行用 `setMagnetometer()` 覆盖。

### 输入法

| 方法 | 说明 |
| --- | --- |
| `getImeText()` / `setImeText(text)` | 读取 / 设置 IME 文本 |

## `InputMap`（动作映射表）

单例，等价于 Godot 的 `InputMap` autoload。

```ts
import { InputMap } from "laya-input";

const map = InputMap.singleton;
map.addAction("dash");
map.actionSetDeadzone("dash", 0.3);
console.log(map.getActions());
```

| 成员 | 说明 |
| --- | --- |
| `InputMap.singleton` | 单例 |
| `InputMap.defaultFile` | 自动载入路径，默认 `resources/inputmap.json` |
| `map.ready` | `Promise`，等待默认映射载入完成 |
| `map.ensureDefaultLoaded()` | 通过 `Laya.loader` 触发自动载入（`Input.install()` 会调用） |
| `map.hasAction(name)` / `getActions()` | 查询动作 |
| `map.addAction(name, deadzone?)` / `eraseAction(name)` / `renameAction(name, newName)` / `clear()` | 动作增删改 |
| `map.actionSetDeadzone(name, dz)` / `actionGetDeadzone(name)` | 死区读写 |
| `map.actionAddEvent(name, event)` / `actionHasEvent(name, event)` / `actionEraseEvent(name, event)` / `actionEraseEvents(name)` / `actionGetEvents(name)` | 动作的事件绑定 |
| `map.eventIsAction(event, name, exactMatch?)` | 事件是否触发该动作 |
| `map.eventGetActionStatus(event, name, exactMatch?)` | 事件的完整动作状态（`active` / `pressed` / `strength` / `rawStrength`） |
| `map.setForcedAction(name, pressed, strength?)` / `getForcedAction(name)` / `clearForcedActions()` | 代码强制状态，由 `Input.actionPress()` 等写入 |
| `map.toJSON()` / `loadFromJSON(data)` / `loadFromFile(url)` | 序列化与载入 |

### `inputmap.json` 格式

```json
{
  "version": 1,
  "actions": [
    {
      "name": "move_left",
      "deadzone": 0.2,
      "events": [
        { "type": "key", "device": -1, "keycode": 65, "physicalKeycode": 65, "keyLabel": 65 },
        { "type": "joypad_motion", "device": -1, "axis": 0, "axisValue": -1 }
      ]
    }
  ]
}
```

`loadFromJSON()` 同时接受裸数组（`[{ name, deadzone, events }]`）与带 `actions` 字段的对象。

各事件类型的 JSON 字段：

| `type` | 字段 |
| --- | --- |
| `key` | `device`、`keycode`、`physicalKeycode`、`keyLabel`、`altPressed`、`shiftPressed`、`ctrlPressed`、`metaPressed` |
| `mouse_button` | `device`、`buttonIndex` |
| `joypad_button` | `device`、`buttonIndex` |
| `joypad_motion` | `device`、`axis`、`axisValue`（只取符号，`+1` / `-1`） |
| `action` | `device`、`action`、`strength` |
| `mouse_motion` / `screen_touch` / `screen_drag` | 不会被绑定为动作规则 |

死亡区换算：`strength = (rawStrength - deadzone) / (1 - deadzone)`，`rawStrength <= deadzone` 时视为 `0`（默认死区 `0.2`，与 Godot 一致）。

## `InputEvent` 家族

| 类 | Godot 等价 |
| --- | --- |
| `InputEventKey` | `InputEventKey` |
| `InputEventMouseButton` | `InputEventMouseButton` |
| `InputEventMouseMotion` | `InputEventMouseMotion` |
| `InputEventJoypadButton` | `InputEventJoypadButton` |
| `InputEventJoypadMotion` | `InputEventJoypadMotion` |
| `InputEventAction` | `InputEventAction` |
| `InputEventScreenTouch` | `InputEventScreenTouch` |
| `InputEventScreenDrag` | `InputEventScreenDrag` |

基类 `InputEvent` 提供 `device`、`isPressed()`、`isEcho()`、`asText()`、`isAction(action, exactMatch?)`、`actionMatch(event, out, deadzone, exactMatch?)`、`isMatch(event)`、`toJSON()` 与静态 `InputEvent.fromJSON(data)`。

与 Godot 的差异：每个事件都有一个只读的 `type: InputEventType` 字符串字段做运行时判别，便于 JSON 序列化（编辑器的输入映射面板正是靠它保存配置）。

辅助函数：

- `createMappingEventFromRuntimeEvent(event)`：把运行时事件转成一条可绑定的映射规则（供编辑器「按下即捕获」使用）。
- `vec2()` / `vec3()` / `quat()`：创建 `Vec2` / `Vec3` / `Quat` 纯数据结构。

## 枚举与工具函数

枚举（取值与 Godot 4.x 一致）：`Key`、`MouseButton`、`MouseButtonMask`、`JoyButton`、`JoyAxis`、`MouseMode`、`CursorShape`、`InputEventType`。

工具函数：

| 函数 | 说明 |
| --- | --- |
| `isSpecialKey(key)` | 是否为 Godot 定义的特殊键 |
| `keyToString(key)` / `stringToKey(name)` | `Key` ↔ 可读名字（`OS.get_keycode_string()` 的等价物） |
| `keyFromDomKey(rawKey)` / `keyFromDomCode(code)` | 浏览器 `KeyboardEvent.key` / `.code` → `Key` |
| `KEY_FROM_KEY` / `KEY_FROM_CODE` | 上述映射的原始表 |
| `joyAxisToString(axis)` / `joyAxisFromString(name)` | `JoyAxis` ↔ 英文标识 |
| `joyButtonToString(button)` / `joyButtonFromString(name)` | `JoyButton` ↔ 英文标识 |
| `joyAxisToDisplayName(axis)` / `joyButtonToDisplayName(button)` / `mouseButtonToString(button)` | 人类可读名字（供下拉框使用） |
| `joyAxisFromGamepadIndex(i)` / `joyButtonFromGamepadIndex(i)` | Gamepad 索引 → 枚举 |
| `cursorShapeToCss(shape)` | `CursorShape` → CSS `cursor` 值 |

## 平台差异与空实现

浏览器 / Web 小游戏运行时能直接实现的接口已全部实现，以下接口受平台限制，保留同名方法以便移植代码原样编译运行：

| 接口 | 行为 |
| --- | --- |
| `hasJoyLight()` / `setJoyLight()` | 固定 `false` / 无副作用（浏览器不暴露手柄灯） |
| `shouldIgnoreDevice()` | 固定 `false` |
| `hasJoyMotionSensors()`、`getJoyGravity()`、`getJoyAccelerometer()`、`getJoyGyroscope()` | 固定 `false` / 零向量 |
| `getJoyTouchpadCount()`、`getJoyTouchpadFingers()`、`getJoyTouchpadFingerPosition()`、`getJoyTouchpadFingerPressure()` | 固定 `0` / `[]` / 零值 |
| `isJoyMotionSensors*` / `setJoyMotionSensors*` / `getJoyMotionSensors*` / `startJoyMotionSensorsCalibration()` 等标定接口 | 空实现（返回 `false` / `0` / `{}`） |
| `getMagnetometer()` | 需自行用 `setMagnetometer()` 写入 |

其他差异：

- 鼠标在浏览器里无法真正「环绕」或限制在窗口内，`CONFINED` 与 `VISIBLE` 的表现一致；`HIDDEN` / `CAPTURED` / `CONFINED_HIDDEN` 一律用 CSS 隐藏系统光标。
- `getMouseScreenPosition()` 与 `getMousePosition()` 在 Web 端返回相同的值。
- 键盘监听挂在 `window` 的**捕获阶段**，即使页面里其它监听器调用了 `stopPropagation()` 也不会吞掉按键；没有 `window` 的运行时（Laya Native / 小游戏）回退到 `Laya.stage` 的 `keydown` / `keyup`。
- 窗口失焦时会自动 `releaseAllInputs()`，避免出现「按键卡住」。

## 在 IDE 里编辑输入映射

仓库内的 `LayaProject/` 是配套的 **LayaAir IDE 扩展**（`src/editor`），提供按 Godot 4「项目设置 → 输入映射」样式实现的树表面板：筛选动作、增删动作、编辑死区、绑定键盘 / 鼠标 / 手柄事件，并读写 `resources/inputmap.json`。

内置的 `ui_*` 动作（对应 Godot 项目默认的 UI 动作）默认**不显示**，需要查看时勾选面板上的「显示内置动作」。

扩展与运行库共用同一份 JSON 格式，因此面板里改完保存即可直接被 `Input` 载入。

## 开发

```bash
npm install      # 安装依赖
npm run build    # 构建产物到 dist/
npm run dev      # 监听源码变化并重建
npm run test     # 运行测试
npm run test:watch
```

构建配置见 `rslib.config.ts`，测试配置见 `rstest.config.ts`，源码入口为 `src/index.ts`：

```
src/
├── index.ts         # 统一出口
├── Input.ts         # Input 单例（Laya 运行时相关）
├── InputMap.ts      # 动作映射表
├── InputEvent.ts    # 事件家族与向量结构
├── InputEnums.ts    # 枚举与按键 / 手柄映射表
└── LayaAir.d.ts     # Laya 运行时类型声明
```

`InputEnums.ts`、`InputEvent.ts`、`InputMap.ts` 不依赖 Laya 运行时与 DOM，可安全地在 IDE 扩展中引用；只有 `Input.ts` 会触碰 `Laya` / `window` / `document`，且全部做了存在性判断。
