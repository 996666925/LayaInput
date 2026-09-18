import { expect, test } from '@rstest/core';
import {
  Input,
  InputEventAction,
  InputEventJoypadButton,
  InputEventKey,
  InputEventMouseButton,
  InputMap,
  JoyAxis,
  JoyButton,
  Key,
  MouseButton,
  createMappingEventFromRuntimeEvent,
} from '../src/index';

test('automatically loads the editor default input map through Laya.loader', async () => {
  const globals: any = globalThis;
  const previousLaya = globals.Laya;
  const previousDefaultFile = InputMap.defaultFile;
  const loaded: Array<{ url: string; type: string }> = [];

  try {
    Input.uninstall();
    InputMap.singleton.clear();
    InputMap.defaultFile = 'resources/inputmap.json';
    globals.Laya = {
      Loader: { JSON: 'json' },
      loader: {
        async load(url: string, type: string) {
          loaded.push({ url, type });
          return {
            data: {
              actions: [{ name: 'jump', deadzone: 0.2, events: [] }],
            },
          };
        },
      },
    };

    Input.install();
    await InputMap.singleton.ready;

    expect(loaded).toEqual([{ url: 'resources/inputmap.json', type: 'json' }]);
    expect(InputMap.singleton.hasAction('jump')).toBe(true);
  } finally {
    Input.uninstall();
    InputMap.singleton.clear();
    InputMap.defaultFile = previousDefaultFile;
    globals.Laya = previousLaya;
  }
});

test('uses Laya stage keyboard events when window is unavailable', () => {
  const listeners = new Map<string, { caller: any; listener: Function }[]>();
  const stage = {
    on(type: string, caller: any, listener: Function) {
      const entries = listeners.get(type) ?? [];
      entries.push({ caller, listener });
      listeners.set(type, entries);
    },
    off(type: string, caller: any, listener: Function) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((entry) => entry.caller !== caller || entry.listener !== listener)
      );
    },
    emit(type: string, event: any) {
      for (const { caller, listener } of listeners.get(type) ?? []) listener.call(caller, event);
    },
  };
  const globals: any = globalThis;
  const previousLaya = globals.Laya;

  try {
    globals.Laya = { stage };
    Input.uninstall();
    InputMap.singleton.clear();

    const binding = new InputEventKey();
    binding.keycode = Key.A;
    InputMap.singleton.actionAddEvent('move_left', binding);
    const alternateBinding = new InputEventKey();
    alternateBinding.keycode = Key.B;
    InputMap.singleton.actionAddEvent('move_left', alternateBinding);

    Input.install();
    expect(listeners.get('keydown')?.length).toBe(1);
    expect(listeners.get('keyup')?.length).toBe(1);

    stage.emit('keydown', { key: 'a' });
    expect(Input.isKeyPressed(Key.A)).toBe(true);
    expect(Input.isActionPressed('move_left')).toBe(true);
    expect(Input.isActionJustPressed('move_left', true)).toBe(true);

    stage.emit('keyup', { key: 'a' });
    expect(Input.isKeyPressed(Key.A)).toBe(false);
    expect(Input.isActionPressed('move_left')).toBe(false);
    expect(Input.isActionJustReleased('move_left', true)).toBe(true);

    Input.update();
    stage.emit('keydown', { key: 'Control', ctrlKey: true });
    stage.emit('keydown', { key: 'a', ctrlKey: true });
    expect(Input.isActionPressed('move_left')).toBe(true);
    expect(Input.isActionPressed('move_left', true)).toBe(false);
    expect(Input.isActionJustPressed('move_left')).toBe(true);
    expect(Input.isActionJustPressed('move_left', true)).toBe(false);
    stage.emit('keyup', { key: 'a', ctrlKey: true });
    stage.emit('keyup', { key: 'Control' });

    Input.update();
    Input.update();
    stage.emit('keydown', { key: 'a' });
    stage.emit('keydown', { key: 'b' });
    stage.emit('keyup', { key: 'a' });
    expect(Input.isActionPressed('move_left')).toBe(true);
    expect(Input.isActionJustReleased('move_left')).toBe(false);
    stage.emit('keyup', { key: 'b' });
    expect(Input.isActionPressed('move_left')).toBe(false);
    expect(Input.isActionJustReleased('move_left')).toBe(true);
  } finally {
    Input.uninstall();
    InputMap.singleton.clear();
    globals.Laya = previousLaya;
  }
});

test('matches release events and applies exact modifier matching', () => {
  const map = new InputMap();
  const binding = new InputEventKey();
  binding.keycode = Key.SPACE;
  map.actionAddEvent('jump', binding);

  const down = new InputEventKey();
  down.keycode = Key.SPACE;
  down.pressed = true;
  expect(map.eventIsAction(down, 'jump')).toBe(true);
  expect(map.eventIsAction(down, 'jump', true)).toBe(true);

  down.ctrlPressed = true;
  expect(map.eventIsAction(down, 'jump')).toBe(true);
  expect(map.eventIsAction(down, 'jump', true)).toBe(false);

  const up = new InputEventKey();
  up.keycode = Key.SPACE;
  up.pressed = false;
  const releaseStatus = map.eventGetActionStatus(up, 'jump');
  expect(releaseStatus.active).toBe(true);
  expect(releaseStatus.pressed).toBe(false);
  expect(releaseStatus.strength).toBe(0);

  const actionRelease = new InputEventAction();
  actionRelease.action = 'jump';
  actionRelease.pressed = false;
  expect(map.eventGetActionStatus(actionRelease, 'jump')).toEqual({
    active: true,
    pressed: false,
    strength: 0,
    rawStrength: 0,
  });
});

test('keeps manually parsed input pressed until its release event', () => {
  const map = InputMap.singleton;
  try {
    Input.uninstall();
    map.clear();
    const binding = new InputEventKey();
    binding.keyLabel = Key.A;
    map.actionAddEvent('manual_key', binding);

    const down = new InputEventKey();
    down.keyLabel = Key.A;
    down.pressed = true;
    Input.parseInputEvent(down);
    expect(Input.isActionPressed('manual_key')).toBe(true);
    Input.update();
    expect(Input.isActionPressed('manual_key')).toBe(true);

    const up = new InputEventKey();
    up.keyLabel = Key.A;
    up.pressed = false;
    Input.parseInputEvent(up);
    expect(Input.isActionPressed('manual_key')).toBe(false);
    expect(Input.isActionJustReleased('manual_key')).toBe(true);

    const actionDown = new InputEventAction();
    actionDown.action = 'manual_action';
    actionDown.pressed = true;
    actionDown.strength = 0.6;
    Input.parseInputEvent(actionDown);
    Input.update();
    expect(Input.isActionPressed('manual_action')).toBe(true);
    expect(Input.getActionRawStrength('manual_action')).toBe(0.6);

    const actionUp = new InputEventAction();
    actionUp.action = 'manual_action';
    actionUp.pressed = false;
    Input.parseInputEvent(actionUp);
    expect(Input.isActionPressed('manual_action')).toBe(false);

    const joyBinding = new InputEventJoypadButton();
    joyBinding.buttonIndex = JoyButton.B;
    map.actionAddEvent('manual_joy', joyBinding);
    const joyDown = new InputEventJoypadButton();
    joyDown.device = 7;
    joyDown.buttonIndex = JoyButton.B;
    joyDown.pressed = true;
    Input.parseInputEvent(joyDown);
    Input.update();
    expect(Input.isActionPressed('manual_joy')).toBe(true);
    joyDown.pressed = false;
    Input.parseInputEvent(joyDown);
    expect(Input.isActionPressed('manual_joy')).toBe(false);
  } finally {
    Input.uninstall();
    map.clear();
  }
});

test('preserves keyboard and mouse modifiers in mapping JSON', () => {
  const key = new InputEventKey();
  key.keycode = Key.S;
  key.ctrlPressed = true;
  key.shiftPressed = true;
  const keyMapping = createMappingEventFromRuntimeEvent(key) as InputEventKey;
  expect(keyMapping.ctrlPressed).toBe(true);
  expect(keyMapping.shiftPressed).toBe(true);
  expect(InputEventKey.fromJSON(keyMapping.toJSON()).isMatch(keyMapping)).toBe(true);

  const mouse = new InputEventMouseButton();
  mouse.buttonIndex = MouseButton.LEFT;
  mouse.altPressed = true;
  const mouseMapping = createMappingEventFromRuntimeEvent(mouse) as InputEventMouseButton;
  expect(mouseMapping.altPressed).toBe(true);
  expect(InputEventMouseButton.fromJSON(mouseMapping.toJSON()).isMatch(mouseMapping)).toBe(true);
});

test('synchronizes cached action state after rename and erase', () => {
  const map = InputMap.singleton;
  try {
    Input.uninstall();
    map.clear();

    Input.actionPress('old_name');
    expect(Input.isActionPressed('old_name')).toBe(true);

    expect(map.renameAction('old_name', 'new_name')).toBe(true);
    expect(Input.isActionPressed('old_name')).toBe(false);
    expect(Input.isActionPressed('new_name')).toBe(true);

    map.eraseAction('new_name');
    expect(Input.isActionPressed('new_name')).toBe(false);
  } finally {
    Input.uninstall();
    map.clear();
  }
});

test('returns a normalized vector and uses the average action deadzone', () => {
  const map = InputMap.singleton;
  try {
    Input.uninstall();
    map.clear();
    map.addAction('left', 0);
    map.addAction('right', 0);
    map.addAction('up', 0);
    map.addAction('down', 0.8);

    Input.actionPress('right', 1);
    Input.actionPress('down', 1);
    const diagonal = Input.getVector('left', 'right', 'up', 'down');
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 10);

    Input.actionRelease('down');
    Input.actionPress('right', 0.5);
    const half = Input.getVector('left', 'right', 'up', 'down');
    expect(half.x).toBeCloseTo(0.375, 10);
    expect(half.y).toBe(0);
  } finally {
    Input.uninstall();
    map.clear();
  }
});

test('retries the default input map after a failed load', async () => {
  const globals: any = globalThis;
  const previousLaya = globals.Laya;
  let attempts = 0;
  const map = new InputMap();

  try {
    globals.Laya = {
      Loader: { JSON: 'json' },
      loader: {
        async load() {
          attempts++;
          if (attempts === 1) throw new Error('temporary failure');
          return { actions: [{ name: 'retry_succeeded', events: [] }] };
        },
      },
    };

    await map.ensureDefaultLoaded();
    await map.ensureDefaultLoaded();
    expect(attempts).toBe(2);
    expect(map.hasAction('retry_succeeded')).toBe(true);
  } finally {
    globals.Laya = previousLaya;
  }
});

test('reads standard gamepad triggers and wildcard bindings from every device', () => {
  const globals: any = globalThis;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const map = InputMap.singleton;
  let pads: any[] = [];
  const button = (value = 0) => ({ pressed: value > 0.5, touched: value > 0, value });
  const pad = (id: string) => ({
    id,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    buttons: Array.from({ length: 17 }, () => button()),
    axes: [0, 0, 0, 0],
  });

  try {
    Input.uninstall();
    map.clear();
    const first = pad('first');
    const second = pad('second');
    first.buttons[6] = button(0.75);
    second.buttons[0] = button(1);
    pads = [first, second];
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { getGamepads: () => pads },
    });

    const fire = new InputEventJoypadButton();
    fire.buttonIndex = JoyButton.A;
    map.actionAddEvent('fire', fire);
    Input.update();

    expect(Input.getJoyAxis(0, JoyAxis.TRIGGER_LEFT)).toBeCloseTo(0.5, 10);
    expect(Input.isActionPressed('fire')).toBe(true);

    Input.setIgnoringJoypad(true);
    expect(Input.isActionPressed('fire')).toBe(false);
    const ignoredPress = new InputEventJoypadButton();
    ignoredPress.device = 1;
    ignoredPress.buttonIndex = JoyButton.A;
    ignoredPress.pressed = true;
    Input.parseInputEvent(ignoredPress);
    Input.update();
    expect(Input.isActionPressed('fire')).toBe(false);

    Input.setIgnoringJoypad(false);
    Input.update();
    expect(Input.isActionPressed('fire')).toBe(true);

    pads = [first, null];
    Input.update();
    expect(Input.isJoyButtonPressed(1, JoyButton.A)).toBe(false);
    expect(Input.isActionPressed('fire')).toBe(false);
  } finally {
    Input.setIgnoringJoypad(false);
    pads = [null, null];
    Input.update();
    Input.uninstall();
    map.clear();
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else delete globals.navigator;
  }
});

test('removes device sensor listeners when uninstalled', () => {
  const globals: any = globalThis;
  const previousWindow = globals.window;
  const listeners = new Map<string, EventListener>();

  try {
    globals.window = {
      addEventListener(type: string, listener: EventListener) {
        listeners.set(type, listener);
      },
      removeEventListener(type: string, listener: EventListener) {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
    };

    Input.getGravity();
    Input.getDeviceOrientation();
    expect(listeners.has('devicemotion')).toBe(true);
    expect(listeners.has('deviceorientation')).toBe(true);

    Input.uninstall();
    expect(listeners.size).toBe(0);
  } finally {
    Input.uninstall();
    globals.window = previousWindow;
  }
});
