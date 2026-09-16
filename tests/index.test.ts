import { expect, test } from '@rstest/core';
import { Input, InputEventKey, InputMap, Key } from '../src/index';

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

    Input.install();
    expect(listeners.get('keydown')?.length).toBe(1);
    expect(listeners.get('keyup')?.length).toBe(1);

    stage.emit('keydown', { key: 'a' });
    expect(Input.isKeyPressed(Key.A)).toBe(true);
    expect(Input.isActionPressed('move_left')).toBe(true);

    stage.emit('keyup', { key: 'a' });
    expect(Input.isKeyPressed(Key.A)).toBe(false);
    expect(Input.isActionPressed('move_left')).toBe(false);
  } finally {
    Input.uninstall();
    InputMap.singleton.clear();
    globals.Laya = previousLaya;
  }
});
