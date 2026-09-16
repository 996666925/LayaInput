/**
 * 输入映射编辑器（LayaAir IDE 扩展面板）。
 *
 * 界面按 Godot 4「项目设置 → 输入映射」页的结构实现（单棵带列的树表）：
 *
 *  ┌────────────────────────────────────────────────────────────────────┐
 *  │ [按名称筛选        ]  [按事件筛选        ]            清除筛选      │
 *  │ [添加新动作              ]   [ 添加 ]   [ 显示内置动作]             │
 *  ├────────────────────────────────────────────────────────────────────┤
 *  │              动作              │  死区  │   ↺  +  ⋮  ✕            │
 *  │ ▾ move_left                    │  0.20  │   ↺  +  ⋮  ✕            │
 *  │     A                          │        │        ⋮  ✕            │
 *  │     Left                       │        │        ⋮  ✕            │
 *  ├────────────────────────────────────────────────────────────────────┤
 *  │ resources/inputmap.json  状态         [重新载入] [保存]             │
 *  └────────────────────────────────────────────────────────────────────┘
 *
 * 内置动作（`ui_accept` 等 Godot 默认 UI 动作）默认**不显示**，
 * 需要查看时勾选「显示内置动作」。
 *
 * 注意：LayaAir 的 `gui.Label` 只是容器，文字必须挂在 `gui.TextField` 上，
 * 因此本文件统一用 `createText()` 造文本控件。
 *
 * 本文件运行在 IDE 的 UI 进程，不能引用 Laya 运行时。
 */

import { InputEventType, Key, MouseButton, keyFromDomKey, keyToString } from "./InputEnums";
import {
  InputActionData,
  InputEventData,
  InputMapData,
  createDefaultMapData,
  describeEventData,
  eventRowLabel,
  makeUniqueActionName,
  mapDataFromJSON,
  mapDataToJSON,
} from "./InputMapEditorTypes";

/* ------------------------------------------------------------------ */
/*                            常量与主题                              */
/* ------------------------------------------------------------------ */

const PANEL_ID = "com.godot.input.InputMapEditor";
const DEFAULT_RELATIVE_PATH = "resources/inputmap.json";

/** 行高。 */
const ROW_HEIGHT = 24;
/** 表头高度。 */
const HEADER_HEIGHT = 22;
/** 图标按钮尺寸。 */
const ICON_SIZE = 20;
/** 图标按钮列宽度（4 个槽位：恢复默认 / 添加事件 / 更多 / 删除）。 */
const ICON_COL_WIDTH = ICON_SIZE * 4 + 8;
/** 死区列宽度。 */
const DEADZONE_COL_WIDTH = 104;
/** 面板外边距。 */
const MARGIN = 8;
/** 顶部两行输入区各自的占位高度。 */
const TOP_ROW_HEIGHT = 30;
/** 底部栏高度。 */
const FOOTER_HEIGHT = 34;
/** 动作名左边距（让开折叠箭头）。 */
const ACTION_TEXT_X = 26;
/** 事件名左边距（比动作多缩进一级）。 */
const EVENT_TEXT_X = 42;
/** 双击判定间隔（毫秒）。 */
const DOUBLE_CLICK_MS = 350;

/** Godot 暗色主题的近似取色。 */
const COLOR_WINDOW = "#2b2b2b";
const COLOR_TREE = "#212121";
const COLOR_ROW_ACTION = "#2c2c2c";
const COLOR_ROW_EVENT = "#242424";
const COLOR_ROW_SELECTED = "#4a4a4a";
const COLOR_HEADER = "#2e2e2e";
const COLOR_LINE = "#3a3a3a";
const COLOR_TEXT = "#dcdcdc";
const COLOR_TEXT_DIM = "#9a9a9a";
const COLOR_TEXT_ERROR = "#ff6b6b";
/** 行首 / 图标列里符号按钮的颜色。 */
const COLOR_ICON = "#c8c8c8";
const COLOR_ICON_HOVER = "#ffffff";
/** 符号按钮的字号（比正文大一点，当图标用）。 */
const ICON_FONT_SIZE = 14;
/** 折叠箭头的占位宽度。 */
const ARROW_WIDTH = 18;

/** 内置动作（对应 Godot 项目默认的 UI 动作），用于「显示内置动作」筛选与「恢复默认」。 */
const BUILTIN_ACTIONS: Readonly<Record<string, string[]>> = {
  ui_accept: ["Enter", "Space", "Kp Enter"],
  ui_select: ["Space"],
  ui_cancel: ["Escape"],
  ui_focus_next: ["Tab"],
  ui_focus_prev: ["Shift+Tab"],
  ui_left: ["Left", "A"],
  ui_right: ["Right", "D"],
  ui_up: ["Up", "W"],
  ui_down: ["Down", "S"],
};

/** 界面文案，集中放置便于统一调整。 */
const T = {
  filterByName: "按名称筛选",
  filterByEvent: "按事件筛选",
  clearAll: "清除筛选",
  addActionPlaceholder: "添加新动作",
  add: "添加",
  showBuiltin: "显示内置动作",
  columnAction: "动作",
  columnDeadzone: "死区",
  menuAddKey: "键盘按键",
  menuAddMouse: "鼠标按键",
  menuAddJoyButton: "手柄按键",
  menuAddJoyAxis: "手柄摇杆轴",
  menuEdit: "重新捕获",
  menuDuplicate: "复制",
  menuDelete: "删除",
  menuRename: "重命名",
  reload: "重新载入",
  save: "保存",
  tipCollapse: "折叠",
  tipExpand: "展开",
  tipReset: "恢复默认死区与默认按键",
  tipAddEvent: "添加输入事件",
  tipOptions: "更多操作",
  tipDelete: "删除",
  hintCapture: "请按下要绑定的输入…（Esc 取消）",
  hintCaptureEdit: "请按下新的输入…（Esc 取消）",
  hintCancelled: "已取消",
  needAction: "请先选择一个动作",
  noActionToWrite: "没有可写入的动作",
  noBuiltin: "没有可显示的动作",
  noBuiltinHidden: "没有可显示的动作（内置动作已隐藏，勾选「显示内置动作」可查看）",
  defaultLoaded: "已载入默认输入映射",
  duplicateSuffix: "已存在同名动作",
};

/** 由 CSS 颜色串生成 gui.Color。 */
function color(css: string): gui.Color {
  return new gui.Color(css);
}

/* ------------------------------------------------------------------ */
/*                          可滚动区域                                */
/* ------------------------------------------------------------------ */

/** 无滚动条的滚动容器：负责裁剪、滚轮滚动与行的可见性剔除。 */
class ScrollArea {
  public readonly root: gui.Panel;
  public readonly content: gui.Widget;

  private _contentHeight = 0;
  private _scrollY = 0;

  constructor() {
    this.root = new gui.Panel();
    this.root.clipping = true;
    this.root.background = new gui.SRect(0, null, color(COLOR_TREE));

    this.content = new gui.Widget();
    this.content.setSize(10, 0);
    this.root.addChild(this.content);

    this.root.on("mouse_wheel", (evt: gui.Event) => {
      const delta = evt.input ? evt.input.mouseWheelDelta : 0;
      if (delta) this.scrollBy(delta > 0 ? -ROW_HEIGHT * 3 : ROW_HEIGHT * 3);
      evt.stopPropagation();
    });
  }

  get scrollY(): number {
    return this._scrollY;
  }

  setContentHeight(height: number): void {
    this._contentHeight = height;
    this.content.setSize(Math.max(this.root.width, 10), Math.max(height, this.root.height));
    this.clampScroll();
    this.applyScroll();
  }

  setBounds(x: number, y: number, width: number, height: number): void {
    this.root.setPos(x, y);
    this.root.setSize(Math.max(width, 20), Math.max(height, ROW_HEIGHT));
    this.content.setSize(this.root.width, Math.max(this._contentHeight, this.root.height));
    this.clampScroll();
    this.applyScroll();
  }

  /** 让指定 y 区间滚入视野。 */
  ensureVisible(top: number, bottom: number): void {
    if (top < this._scrollY) this._scrollY = top;
    else if (bottom > this._scrollY + this.root.height) this._scrollY = bottom - this.root.height;
    this.clampScroll();
    this.applyScroll();
  }

  private scrollBy(delta: number): void {
    this._scrollY += delta;
    this.clampScroll();
    this.applyScroll();
  }

  private clampScroll(): void {
    const max = Math.max(this._contentHeight - this.root.height, 0);
    this._scrollY = Math.min(Math.max(this._scrollY, 0), max);
  }

  private applyScroll(): void {
    this.content.setPos(0, -Math.round(this._scrollY));

    // 容器已开启 clipping；这里再兜一层可见性剔除，避免平台裁剪差异导致溢出。
    const viewTop = this._scrollY;
    const viewBottom = this._scrollY + this.root.height;
    for (const child of this.content.children) {
      child.visible = child.y + child.height > viewTop && child.y < viewBottom;
    }
  }
}

/** 树表里的一行。 */
interface RowModel {
  kind: "action" | "event";
  /** 对应 `InputMapData.actions` 的下标。 */
  actionIndex: number;
  /** 事件行对应的 `events` 下标，动作行为 -1。 */
  eventIndex: number;
  action: InputActionData;
  event: InputEventData;
}

/**
 * Godot 风格的输入映射树表面板。
 */
@IEditor.panel(PANEL_ID, {
  title: "输入映射",
  location: "right",
  order: 120,
  allowPopup: true,
  showInMenu: true,
  menuGroup: "Godot 输入",
  hotkey: "mod+alt+i",
})
export class InputMapEditorPanel extends IEditor.EditorPanel {
  /* 顶部：筛选行 */
  private _filterNameInput: IEditor.TextInput;
  private _filterEventInput: IEditor.TextInput;
  private _clearFilterButton: gui.Button;

  /* 顶部：新增动作行 */
  private _newActionInput: IEditor.TextInput;
  private _addActionButton: gui.Button;
  private _builtinCheckbox: gui.Button;

  /* 表头 */
  private _headerBar: gui.Box;
  private _headerActionText: gui.TextField;
  private _headerDeadzoneText: gui.TextField;

  /* 树表 */
  private _tree: ScrollArea;
  private _separator1: gui.Box;
  private _separator2: gui.Box;
  private _rows: gui.Box[] = [];
  private _deadzoneInputs: Array<{ input: IEditor.NumericInput; actionIndex: number }> = [];

  /* 重命名浮层 */
  private _renameInput: IEditor.TextInput;

  /* 底部栏 */
  private _pathInput: IEditor.TextInput;
  private _reloadButton: gui.Button;
  private _saveButton: gui.Button;
  private _statusText: gui.TextField;

  /* 数据 */
  private _data: InputMapData = new InputMapData();
  private _selectedActionIndex = -1;
  private _selectedEventIndex = -1;
  private _collapsed: Set<string> = new Set();
  private _renamingActionIndex = -1;
  private _revision = 0;
  private _renderedRevision = -1;
  private _filterByName = "";
  private _filterByEvent = "";
  /** 是否在列表里显示内置动作（`ui_*`）。默认隐藏，避免首次打开时列表被内置动作占满。 */
  private _showBuiltin = false;
  /**
   * 新增动作输入框是否刚刚通过“失焦/回车提交”创建过动作。
   *
   * 编辑器的输入框在回车和失焦时都会派发 `submit`：点击「添加」按钮时，
   * 输入框会先失焦并创建一次，随后 click 回调又会拿到一次机会。
   * 这个标记用来吃掉那次多余的点击，避免一次操作加出两个动作。
   */
  private _addRowSubmitPending = false;

  /* 捕获状态 */
  private _captureType: InputEventType = InputEventType.NONE;
  private _captureReplace: { actionIndex: number; eventIndex: number } | null = null;
  private _gamepadPrevious: boolean[] = [];

  private _lastWidth = -1;
  private _lastHeight = -1;
  private _lastDoubleClick: { key: string; time: number } = { key: "", time: 0 };

  /* ------------------------------------------------------------------ */
  /*                            生命周期                                */
  /* ------------------------------------------------------------------ */

  async create(): Promise<void> {
    const root = new gui.Box();
    root.background = new gui.SRect(0, null, color(COLOR_WINDOW));
    this._panel = root;

    this._createFilterRow(root);
    this._createAddRow(root);
    this._createHeader(root);
    this._createTree(root);
    this._createRenameOverlay(root);
    this._createFooter(root);

    await this.loadFromDisk(false);
  }

  onUpdate(): void {
    this.layoutIfNeeded();
    this.syncInputsFromUi();
    if (this._captureType !== InputEventType.NONE) this.pollGamepadCapture();
    if (this._revision !== this._renderedRevision) this.renderRows();
  }

  onDestroy(): void {
    this.cancelCapture();
  }

  /* ------------------------------------------------------------------ */
  /*                            界面搭建                                */
  /* ------------------------------------------------------------------ */

  private _createFilterRow(root: gui.Widget): void {
    this._filterNameInput = this.createTextInput(T.filterByName);
    root.addChild(this._filterNameInput);

    this._filterEventInput = this.createTextInput(T.filterByEvent);
    root.addChild(this._filterEventInput);

    this._clearFilterButton = this.createButton(T.clearAll, 84, () => {
      this._filterNameInput.text = "";
      this._filterEventInput.text = "";
      this._filterByName = "";
      this._filterByEvent = "";
      this._revision++;
    });
    root.addChild(this._clearFilterButton);
  }

  private _createAddRow(root: gui.Widget): void {
    this._newActionInput = this.createTextInput(T.addActionPlaceholder);
    // 编辑器的 TextInput 在「回车」和「失焦」时都会派发 submit。
    // 这里必须要求输入框里真的有名字，否则点一下输入框再点别处就会冒出一个 new_action。
    this._newActionInput.on("submit", () => this.submitNewAction());
    root.addChild(this._newActionInput);

    this._addActionButton = this.createButton(T.add, 64, () => this.clickAddAction());
    root.addChild(this._addActionButton);

    this._builtinCheckbox = IEditor.GUIUtils.createCheckbox(false);
    this._builtinCheckbox.title = T.showBuiltin;
    this._builtinCheckbox.selected = false;
    this._builtinCheckbox.setSize(150, ICON_SIZE);
    this._builtinCheckbox.onClick(() => {
      this._showBuiltin = !this._showBuiltin;
      this._builtinCheckbox.selected = this._showBuiltin;
      // 隐藏内置动作后，若当前选中的正好是内置动作，选中项会从列表里消失，
      // 这里把选中项挪到第一个可见动作，避免“看不见的选中项”被后续操作误伤。
      if (!this._showBuiltin && this.isBuiltinAction(this._selectedActionIndex)) {
        this.selectFirstVisibleAction();
      }
      this._revision++;
    });
    root.addChild(this._builtinCheckbox);
  }

  private _createHeader(root: gui.Widget): void {
    this._headerBar = new gui.Box();
    this._headerBar.background = new gui.SRect(0, null, color(COLOR_HEADER));
    root.addChild(this._headerBar);

    this._headerActionText = this.createText(T.columnAction, COLOR_TEXT, 12, gui.AlignType.Center);
    this._headerBar.addChild(this._headerActionText);

    this._headerDeadzoneText = this.createText(T.columnDeadzone, COLOR_TEXT, 12, gui.AlignType.Center);
    this._headerBar.addChild(this._headerDeadzoneText);
  }

  private _createTree(root: gui.Widget): void {
    this._tree = new ScrollArea();
    root.addChild(this._tree.root);

    this._separator1 = new gui.Box();
    this._separator1.background = new gui.SRect(0, null, color(COLOR_LINE));
    root.addChild(this._separator1);

    this._separator2 = new gui.Box();
    this._separator2.background = new gui.SRect(0, null, color(COLOR_LINE));
    root.addChild(this._separator2);
  }

  private _createRenameOverlay(root: gui.Widget): void {
    this._renameInput = this.createTextInput();
    this._renameInput.visible = false;
    this._renameInput.on("submit", () => this.commitRename());
    this._renameInput.on("focus_out", () => this.commitRename());
    root.addChild(this._renameInput);
  }

  private _createFooter(root: gui.Widget): void {
    this._pathInput = this.createTextInput();
    this._pathInput.text = DEFAULT_RELATIVE_PATH;
    root.addChild(this._pathInput);

    this._reloadButton = this.createButton(T.reload, 76, () => void this.loadFromDisk(true));
    root.addChild(this._reloadButton);

    this._saveButton = this.createButton(T.save, 66, () => void this.save());
    root.addChild(this._saveButton);

    this._statusText = this.createText("", COLOR_TEXT_DIM, 12);
    root.addChild(this._statusText);
  }

  /* ------------------------------------------------------------------ */
  /*                            控件工厂                                */
  /* ------------------------------------------------------------------ */

  /**
   * 创建文本控件。
   *
   * 关键：LayaAir 的 `gui.Label` 只是容器，真正渲染文字的是 `gui.TextField`，
   * 因此所有文字都直接用 `TextField` 创建。
   */
  private createText(
    text: string,
    hex: string,
    fontSize: number = 12,
    align: gui.AlignType = gui.AlignType.Left
  ): gui.TextField {
    const field = new gui.TextField();
    field.autoSize = gui.TextAutoSize.None;
    field.style.fontSize = fontSize;
    field.style.color = color(hex).getHex();
    field.style.align = align;
    field.style.valign = gui.VAlignType.Middle;
    field.text = text;
    field.setSize(120, ICON_SIZE);
    // 纯展示文字一律不接收点击，否则会挡住底下的输入框和行选中。
    field.touchable = false;
    return field;
  }

  /**
   * 创建单行输入框。
   *
   * 占位提示直接交给输入框内部的 `gui.TextInput.prompt` 处理，
   * 不要在外面盖一层文本控件 —— 那会截走点击，导致输入框无法聚焦。
   */
  private createTextInput(prompt: string = ""): IEditor.TextInput {
    const input = IEditor.GUIUtils.createTextInput();
    input.setSize(120, ICON_SIZE + 2);
    if (prompt) {
      try {
        const field: any = (input as any)._textField;
        if (field && "prompt" in field) field.prompt = prompt;
      } catch (error) {
        // 拿不到内部输入框时只是少了占位提示，不影响输入。
      }
    }
    return input;
  }

  private createButton(title: string, width: number, onClick: () => void): gui.Button {
    const button = IEditor.GUIUtils.createButton(false);
    button.title = title;
    button.setSize(width, ICON_SIZE + 2);
    button.onClick(() => onClick());
    return button;
  }

  /**
   * 行首折叠箭头与图标列里的小按钮。
   *
   * 不用 `GUIUtils.createIconButton()` —— 那种按钮靠图标资源渲染，
   * 没有图标资源时 `title` 也不会显示出来。这里改用扁平的可点击文本，
   * 既保证可见，外观也更接近 Godot 的无边框图标按钮。
   */
  private createGlyphButton(glyph: string, tip: string, width: number, onClick: () => void): gui.TextField {
    const field = this.createText(glyph, COLOR_ICON, ICON_FONT_SIZE, gui.AlignType.Center);
    field.setSize(width, ICON_SIZE);
    field.tooltips = tip;
    field.touchable = true; // createText 默认关掉了点击，符号按钮需要打开
    field.onClick(() => onClick());
    field.on("roll_over", () => {
      field.color = color(COLOR_ICON_HOVER).getHex();
    });
    field.on("roll_out", () => {
      field.color = color(COLOR_ICON).getHex();
    });
    return field;
  }

  /* ------------------------------------------------------------------ */
  /*                             布局                                   */
  /* ------------------------------------------------------------------ */

  private actionColumnWidth(totalWidth: number): number {
    return Math.max(totalWidth - DEADZONE_COL_WIDTH - ICON_COL_WIDTH, 80);
  }

  private layoutIfNeeded(): void {
    if (!this._panel) return;
    const width = this.contentPane.width;
    const height = this.contentPane.height;
    if (width <= 0 || height <= 0) return;
    if (width === this._lastWidth && height === this._lastHeight) return;
    this._lastWidth = width;
    this._lastHeight = height;

    const innerX = MARGIN;
    const innerWidth = Math.max(width - MARGIN * 2, 160);
    const gap = 6;

    // ---- 第一行：两个筛选框 + 清除筛选 ----
    const row1Y = MARGIN;
    const clearWidth = 84;
    const searchWidth = Math.max((innerWidth - clearWidth - gap * 3) / 2, 60);

    this._filterNameInput.setPos(innerX, row1Y);
    this._filterNameInput.setSize(searchWidth, ICON_SIZE + 2);
    this._filterEventInput.setPos(innerX + searchWidth + gap, row1Y);
    this._filterEventInput.setSize(searchWidth, ICON_SIZE + 2);
    this._clearFilterButton.setPos(innerX + innerWidth - clearWidth, row1Y + 1);
    this._clearFilterButton.setSize(clearWidth, ICON_SIZE);

    // ---- 第二行：添加新动作 + 添加 + 显示内置动作 ----
    const row2Y = row1Y + TOP_ROW_HEIGHT;
    const checkboxWidth = 150;
    const addWidth = 64;
    const newWidth = Math.max(innerWidth - checkboxWidth - addWidth - gap * 2, 80);

    this._newActionInput.setPos(innerX, row2Y);
    this._newActionInput.setSize(newWidth, ICON_SIZE + 2);
    this._addActionButton.setPos(innerX + newWidth + gap, row2Y + 1);
    this._addActionButton.setSize(addWidth, ICON_SIZE);
    this._builtinCheckbox.setPos(innerX + innerWidth - checkboxWidth, row2Y + 1);
    this._builtinCheckbox.setSize(checkboxWidth, ICON_SIZE);

    // ---- 表头 ----
    const headerY = row2Y + TOP_ROW_HEIGHT + 2;
    this._headerBar.setPos(innerX, headerY);
    this._headerBar.setSize(innerWidth, HEADER_HEIGHT);

    const actionWidth = this.actionColumnWidth(innerWidth);
    this._headerActionText.setPos(0, 1);
    this._headerActionText.setSize(actionWidth, HEADER_HEIGHT - 3);
    this._headerDeadzoneText.setPos(actionWidth, 1);
    this._headerDeadzoneText.setSize(DEADZONE_COL_WIDTH, HEADER_HEIGHT - 3);

    // ---- 树表 ----
    const footerY = Math.max(height - FOOTER_HEIGHT, headerY + HEADER_HEIGHT + ROW_HEIGHT * 2);
    const treeY = headerY + HEADER_HEIGHT + 1;
    const treeHeight = Math.max(footerY - treeY - 2, ROW_HEIGHT * 2);
    this._tree.setBounds(innerX, treeY, innerWidth, treeHeight);

    // 列分隔线（不随滚动移动）
    this._separator1.setPos(innerX + actionWidth, treeY);
    this._separator1.setSize(1, treeHeight);
    this._separator2.setPos(innerX + actionWidth + DEADZONE_COL_WIDTH, treeY);
    this._separator2.setSize(1, treeHeight);

    // ---- 底部栏 ----
    const saveWidth = 66;
    const reloadWidth = 76;
    const saveX = width - MARGIN - saveWidth;
    const reloadX = saveX - gap - reloadWidth;
    const pathWidth = Math.min(240, Math.max(reloadX - MARGIN - 8 - 80, 80));
    const footerControlY = footerY + (FOOTER_HEIGHT - ICON_SIZE - 2) / 2;

    this._pathInput.setSize(pathWidth, ICON_SIZE + 2);
    this._pathInput.setPos(MARGIN, footerControlY);
    this._reloadButton.setSize(reloadWidth, ICON_SIZE + 2);
    this._reloadButton.setPos(reloadX, footerControlY);
    this._saveButton.setSize(saveWidth, ICON_SIZE + 2);
    this._saveButton.setPos(saveX, footerControlY);

    const statusX = MARGIN + pathWidth + 8;
    this._statusText.setPos(statusX, footerY + (FOOTER_HEIGHT - ICON_SIZE) / 2);
    this._statusText.setSize(Math.max(reloadX - statusX - 8, 40), ICON_SIZE);

    // 尺寸变化后必须重排行内容
    this._renderedRevision = -1;
    if (this._renamingActionIndex >= 0) this.positionRenameOverlay();
  }

  /* ------------------------------------------------------------------ */
  /*                          数据 → 树表                               */
  /* ------------------------------------------------------------------ */

  private get selectedAction(): InputActionData | null {
    const actions = this._data.actions || [];
    if (this._selectedActionIndex < 0 || this._selectedActionIndex >= actions.length) return null;
    return actions[this._selectedActionIndex];
  }

  /** 指定下标对应的动作是否是内置动作（`ui_*`）。 */
  private isBuiltinAction(actionIndex: number): boolean {
    const actions = this._data.actions || [];
    if (actionIndex < 0 || actionIndex >= actions.length) return false;
    return !!BUILTIN_ACTIONS[actions[actionIndex].name];
  }

  /** 选中第一个可见动作；一个可见动作都没有时清空选中。 */
  private selectFirstVisibleAction(): void {
    const actions = this._data.actions || [];
    for (let i = 0; i < actions.length; i++) {
      if (!this._showBuiltin && BUILTIN_ACTIONS[actions[i].name]) continue;
      this._selectedActionIndex = i;
      this._selectedEventIndex = -1;
      return;
    }
    this._selectedActionIndex = -1;
    this._selectedEventIndex = -1;
  }

  /** 当前选中项被内置动作筛选挡住时（删除 / 重命名后可能出现），改选第一个可见动作。 */
  private ensureSelectionVisible(): void {
    if (this._showBuiltin) return;
    if (this.isBuiltinAction(this._selectedActionIndex)) this.selectFirstVisibleAction();
  }

  /** 依据筛选与折叠状态，算出要渲染哪些行。 */
  private buildRowModels(): RowModel[] {
    const actions = this._data.actions || [];
    const nameFilter = this._filterByName.trim().toLowerCase();
    const eventFilter = this._filterByEvent.trim().toLowerCase();
    const models: RowModel[] = [];

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      if (!this._showBuiltin && !!BUILTIN_ACTIONS[action.name]) continue;
      if (nameFilter && action.name.toLowerCase().indexOf(nameFilter) < 0) continue;

      const events = action.events || [];
      const matchedEvents: number[] = [];
      for (let e = 0; e < events.length; e++) {
        if (!eventFilter) {
          matchedEvents.push(e);
          continue;
        }
        const text = `${this.describeEvent(events[e])} ${events[e].key || ""}`.toLowerCase();
        if (text.indexOf(eventFilter) >= 0) matchedEvents.push(e);
      }
      // 有事件筛选时，动作名或事件内容任一命中就显示。
      if (eventFilter && matchedEvents.length === 0 && action.name.toLowerCase().indexOf(eventFilter) < 0) continue;

      models.push({ kind: "action", actionIndex: i, eventIndex: -1, action, event: null });

      // 有事件筛选时强制展开，方便直接看到命中项。
      const collapsed = !eventFilter && this._collapsed.has(action.name);
      if (collapsed) continue;
      for (const eventIndex of matchedEvents) {
        models.push({
          kind: "event",
          actionIndex: i,
          eventIndex,
          action,
          event: events[eventIndex],
        });
      }
    }
    return models;
  }

  private renderRows(): void {
    if (!this._tree) return;

    const width = this._tree.root.width;
    if (width <= 0) return; // 还没完成布局，下一帧再渲染

    for (const row of this._rows) this._tree.content.removeChild(row, true);
    this._rows = [];
    this._deadzoneInputs = [];
    this._renderedRevision = this._revision;

    const actionWidth = this.actionColumnWidth(width);
    const models = this.buildRowModels();

    let y = 0;
    for (const model of models) {
      const row =
        model.kind === "action"
          ? this.buildActionRow(model, y, width, actionWidth)
          : this.buildEventRow(model, y, width, actionWidth);
      this._tree.content.addChild(row);
      this._rows.push(row);
      y += ROW_HEIGHT;
    }

    // 没有可见行时给一句提示：默认隐藏内置动作，项目里只有 ui_* 动作时列表会是空的，
    // 没有提示容易被误认为映射没载入成功。
    if (models.length === 0) {
      const filtering = !!this._filterByName.trim() || !!this._filterByEvent.trim();
      const hint = new gui.Box();
      hint.setPos(0, 0);
      hint.setSize(width, ROW_HEIGHT);
      const hintText = this.createText(!filtering && !this._showBuiltin ? T.noBuiltinHidden : T.noBuiltin, COLOR_TEXT_DIM);
      hintText.setPos(ACTION_TEXT_X, 2);
      hintText.setSize(Math.max(width - ACTION_TEXT_X - 4, 40), ICON_SIZE);
      hint.addChild(hintText);
      this._tree.content.addChild(hint);
      this._rows.push(hint);
      y = ROW_HEIGHT;
    }

    this._tree.setContentHeight(y);

    // 选中项滚入视野
    const selectedRow = this.indexOfModel(models, this._selectedActionIndex, this._selectedEventIndex);
    if (selectedRow >= 0) this._tree.ensureVisible(selectedRow * ROW_HEIGHT, (selectedRow + 1) * ROW_HEIGHT);
  }

  private indexOfModel(models: RowModel[], actionIndex: number, eventIndex: number): number {
    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      if (model.actionIndex !== actionIndex) continue;
      if (eventIndex < 0) {
        if (model.kind === "action") return i;
      } else if (model.kind === "event" && model.eventIndex === eventIndex) {
        return i;
      }
    }
    return -1;
  }

  /** 图标列的槽位 x 坐标。 */
  private iconSlotX(columnX: number, slot: number): number {
    return columnX + (ICON_COL_WIDTH - ICON_SIZE * 4) / 2 + slot * ICON_SIZE;
  }

  private buildActionRow(model: RowModel, y: number, width: number, actionWidth: number): gui.Box {
    const action = model.action;
    const selected = model.actionIndex === this._selectedActionIndex && this._selectedEventIndex < 0;
    const collapsed = this._collapsed.has(action.name);

    const row = new gui.Box();
    row.setPos(0, y);
    row.setSize(width, ROW_HEIGHT);
    row.background = new gui.SRect(0, null, color(selected ? COLOR_ROW_SELECTED : COLOR_ROW_ACTION));
    row.onClick(() => this.handleRowClick(model));

    // 展开 / 折叠箭头
    const arrow = this.createGlyphButton(
      collapsed ? "▸" : "▾",
      collapsed ? T.tipExpand : T.tipCollapse,
      ARROW_WIDTH,
      () => this.toggleCollapse(action.name)
    );
    arrow.setPos(2, 2);
    row.addChild(arrow);

    // 动作名（文字不接收点击，双击由整行处理）
    const nameText = this.createText(action.name, COLOR_TEXT);
    nameText.setPos(ACTION_TEXT_X, 2);
    nameText.setSize(Math.max(actionWidth - ACTION_TEXT_X - 4, 40), ICON_SIZE);
    row.addChild(nameText);

    // 死区
    const deadzone = IEditor.GUIUtils.createNumericInput();
    deadzone.min = 0;
    deadzone.max = 1;
    deadzone.fractionDigits = 2;
    deadzone.step = 0.01;
    deadzone.value = action.deadzone;
    deadzone.setPos(actionWidth + 8, 2);
    deadzone.setSize(Math.max(DEADZONE_COL_WIDTH - 16, 40), ICON_SIZE);
    row.addChild(deadzone);
    this._deadzoneInputs.push({ input: deadzone, actionIndex: model.actionIndex });

    // 图标按钮：恢复默认 / 添加事件 / 更多 / 删除
    const iconColumnX = actionWidth + DEADZONE_COL_WIDTH;

    const reset = this.createGlyphButton("↺", T.tipReset, ICON_SIZE, () => this.resetAction(model.actionIndex));
    reset.setPos(this.iconSlotX(iconColumnX, 0), 2);
    row.addChild(reset);

    const addEvent = this.createGlyphButton("+", T.tipAddEvent, ICON_SIZE, () =>
      this.showAddEventMenu(model.actionIndex)
    );
    addEvent.setPos(this.iconSlotX(iconColumnX, 1), 2);
    row.addChild(addEvent);

    const options = this.createGlyphButton("⋮", T.tipOptions, ICON_SIZE, () => this.showActionMenu(model.actionIndex));
    options.setPos(this.iconSlotX(iconColumnX, 2), 2);
    row.addChild(options);

    const remove = this.createGlyphButton("✕", T.tipDelete, ICON_SIZE, () => this.deleteAction(model.actionIndex));
    remove.setPos(this.iconSlotX(iconColumnX, 3), 2);
    row.addChild(remove);

    return row;
  }

  private buildEventRow(model: RowModel, y: number, width: number, actionWidth: number): gui.Box {
    const selected = model.actionIndex === this._selectedActionIndex && model.eventIndex === this._selectedEventIndex;

    const row = new gui.Box();
    row.setPos(0, y);
    row.setSize(width, ROW_HEIGHT);
    row.background = new gui.SRect(0, null, color(selected ? COLOR_ROW_SELECTED : COLOR_ROW_EVENT));
    row.onClick(() => this.handleRowClick(model));

    const text = this.createText(this.describeEvent(model.event), COLOR_TEXT);
    text.setPos(EVENT_TEXT_X, 2);
    text.setSize(Math.max(actionWidth - EVENT_TEXT_X - 4, 40), ICON_SIZE);
    row.addChild(text);

    const iconColumnX = actionWidth + DEADZONE_COL_WIDTH;

    const options = this.createGlyphButton("⋮", T.tipOptions, ICON_SIZE, () =>
      this.showEventMenu(model.actionIndex, model.eventIndex)
    );
    options.setPos(this.iconSlotX(iconColumnX, 2), 2);
    row.addChild(options);

    const remove = this.createGlyphButton("✕", T.tipDelete, ICON_SIZE, () =>
      this.deleteEvent(model.actionIndex, model.eventIndex)
    );
    remove.setPos(this.iconSlotX(iconColumnX, 3), 2);
    row.addChild(remove);

    return row;
  }

  /** 事件行的文字：尽量贴近 Godot 的写法。 */
  private describeEvent(event: InputEventData): string {
    if (!event) return "";
    switch (event.type) {
      case InputEventType.KEY:
        return event.key || "(未设置)";
      case InputEventType.MOUSE_BUTTON:
        return eventRowLabel(event);
      case InputEventType.JOY_BUTTON: {
        const device = event.device >= 0 ? event.device : 0;
        return `手柄按键 ${event.joyButton} - 设备 ${device}`;
      }
      case InputEventType.JOY_MOTION: {
        const device = event.device >= 0 ? event.device : 0;
        const direction = event.joyAxisValue >= 0 ? "+" : "-";
        return `手柄轴 ${event.joyAxis} ${direction} - 设备 ${device}`;
      }
      default:
        return eventRowLabel(event);
    }
  }

  /**
   * 整行点击：单击选中，双击进入编辑。
   *
   * 行内文字都设了 `touchable = false`，所以点击一定落在行本身；
   * gui 没有直接暴露双击，这里用时间戳手工判定。
   */
  private handleRowClick(model: RowModel): void {
    const key = model.kind === "action" ? `a${model.actionIndex}` : `e${model.actionIndex}_${model.eventIndex}`;
    const now = Date.now();
    const isDouble = this._lastDoubleClick.key === key && now - this._lastDoubleClick.time <= DOUBLE_CLICK_MS;
    this._lastDoubleClick = { key: isDouble ? "" : key, time: now };

    if (isDouble) {
      if (model.kind === "action") this.beginRename(model.actionIndex);
      else this.beginCapture(this.captureTypeOf(model.event), model.actionIndex, model.eventIndex);
      return;
    }

    if (model.kind === "action") this.selectAction(model.actionIndex);
    else this.selectEvent(model.actionIndex, model.eventIndex);
  }

  /* ------------------------------------------------------------------ */
  /*                            选择与筛选                              */
  /* ------------------------------------------------------------------ */

  private selectAction(actionIndex: number): void {
    this._selectedActionIndex = actionIndex;
    this._selectedEventIndex = -1;
    this._revision++;
  }

  private selectEvent(actionIndex: number, eventIndex: number): void {
    this._selectedActionIndex = actionIndex;
    this._selectedEventIndex = eventIndex;
    this._revision++;
  }

  private toggleCollapse(actionName: string): void {
    if (this._collapsed.has(actionName)) this._collapsed.delete(actionName);
    else this._collapsed.add(actionName);
    this._revision++;
  }

  /** 同步输入框内容：筛选条件、占位文字、每行的死区。 */
  private syncInputsFromUi(): void {
    const nameText = this._filterNameInput.text || "";
    if (nameText !== this._filterByName) {
      this._filterByName = nameText;
      this._revision++;
    }
    const eventText = this._filterEventInput.text || "";
    if (eventText !== this._filterByEvent) {
      this._filterByEvent = eventText;
      this._revision++;
    }

    for (const entry of this._deadzoneInputs) {
      const action = (this._data.actions || [])[entry.actionIndex];
      if (!action) continue;
      const value = entry.input.value;
      if (typeof value !== "number" || !isFinite(value)) continue;
      const clamped = Math.min(Math.max(value, 0), 1);
      if (Math.abs(clamped - action.deadzone) < 0.0001) continue;
      action.deadzone = clamped;
    }
  }

  private setStatus(text: string, isError: boolean): void {
    if (!this._statusText) return;
    this._statusText.text = text;
    this._statusText.color = color(isError ? COLOR_TEXT_ERROR : COLOR_TEXT_DIM).getHex();
  }

  /* ------------------------------------------------------------------ */
  /*                          动作的增删改                              */
  /* ------------------------------------------------------------------ */

  /**
   * 输入框提交（回车，或点到别处导致失焦）。
   *
   * 编辑器的输入框在失焦时也会派发 `submit`，所以这里只处理「真的填了名字」的情况，
   * 否则点一下输入框再点别处就会凭空多出一个 `new_action`（就是之前一直误触的原因）。
   */
  private submitNewAction(): void {
    const typed = (this._newActionInput.text || "").trim();
    if (!typed) return;
    // 不论成功与否都标记一下：这次失焦后续的按钮点击不应该再重复尝试一次
    // （否则重名时会连弹两次提示）。
    this.addNewAction(typed);
    this._addRowSubmitPending = true;
  }

  /**
   * 点击「添加」按钮。
   *
   * 点按钮时输入框会先失焦，如果那一下已经加过了就直接跳过，
   * 之后（或输入框本来就空时）才允许创建一个默认的 `new_action`。
   */
  private clickAddAction(): void {
    if (this._addRowSubmitPending) {
      this._addRowSubmitPending = false;
      return;
    }
    const typed = (this._newActionInput.text || "").trim();
    this.addNewAction(typed || makeUniqueActionName(this._data, "new_action"));
  }

  /**
   * 真正创建动作。
   * @param name 动作名；调用方保证非空。重名会被拒绝并提示，不会静默改名。
   */
  private addNewAction(name: string): void {
    const actions = this._data.actions || [];
    if (!name) return;
    if (actions.some((item) => item.name === name)) {
      this.setStatus(`动作名 ${name} ${T.duplicateSuffix}`, true);
      Editor.showToast(`动作名 ${name} ${T.duplicateSuffix}`, "warning");
      return;
    }

    const action = new InputActionData();
    action.name = name;
    action.deadzone = 0.2;
    action.events = [];
    actions.push(action);
    this._selectedActionIndex = actions.length - 1;
    this._selectedEventIndex = -1;
    this._newActionInput.text = "";
    this._revision++;
    this.setStatus(`已添加动作 ${name}`, false);
  }

  private deleteAction(actionIndex: number): void {
    const actions = this._data.actions || [];
    const action = actions[actionIndex];
    if (!action) return;
    actions.splice(actionIndex, 1);
    if (this._selectedActionIndex >= actions.length) this._selectedActionIndex = actions.length - 1;
    this._selectedEventIndex = -1;
    this.ensureSelectionVisible();
    this._revision++;
    this.setStatus(`已删除动作 ${action.name}`, false);
  }

  private duplicateAction(actionIndex: number): void {
    const source = (this._data.actions || [])[actionIndex];
    if (!source) return;
    const copy = new InputActionData();
    copy.name = makeUniqueActionName(this._data, `${source.name}_copy`);
    copy.deadzone = source.deadzone;
    copy.events = (source.events || []).map((event) => this.cloneEvent(event));
    this._data.actions.splice(actionIndex + 1, 0, copy);
    this._selectedActionIndex = actionIndex + 1;
    this._selectedEventIndex = -1;
    this._revision++;
    this.setStatus(`已复制为 ${copy.name}`, false);
  }

  /** 恢复默认：内置动作恢复默认按键，所有动作把死区恢复为 0.2。 */
  private resetAction(actionIndex: number): void {
    const action = (this._data.actions || [])[actionIndex];
    if (!action) return;
    action.deadzone = 0.2;

    const defaults = BUILTIN_ACTIONS[action.name];
    if (defaults) {
      action.events = defaults.map((key) => {
        const event = new InputEventData();
        event.type = InputEventType.KEY;
        event.key = key;
        return event;
      });
    }
    this._revision++;
    this.setStatus(`已恢复 ${action.name} 的默认设置`, false);
  }

  private cloneEvent(event: InputEventData): InputEventData {
    const clone = new InputEventData();
    clone.type = event.type;
    clone.key = event.key;
    clone.mouseButton = event.mouseButton;
    clone.joyButton = event.joyButton;
    clone.joyAxis = event.joyAxis;
    clone.joyAxisValue = event.joyAxisValue;
    clone.device = event.device;
    return clone;
  }

  /* ------------------------------------------------------------------ */
  /*                          事件的增删改                              */
  /* ------------------------------------------------------------------ */

  private showAddEventMenu(actionIndex: number): void {
    this._selectedActionIndex = actionIndex;
    const menu = IEditor.Menu.create([
      { id: "key", label: T.menuAddKey, click: () => this.beginCapture(InputEventType.KEY, actionIndex, -1) },
      { id: "mouse", label: T.menuAddMouse, click: () => this.beginCapture(InputEventType.MOUSE_BUTTON, actionIndex, -1) },
      { id: "joyButton", label: T.menuAddJoyButton, click: () => this.beginCapture(InputEventType.JOY_BUTTON, actionIndex, -1) },
      { id: "joyAxis", label: T.menuAddJoyAxis, click: () => this.beginCapture(InputEventType.JOY_MOTION, actionIndex, -1) },
    ]);
    menu.show();
  }

  private showActionMenu(actionIndex: number): void {
    const action = (this._data.actions || [])[actionIndex];
    if (!action) return;
    const menu = IEditor.Menu.create([
      { id: "rename", label: T.menuRename, click: () => this.beginRename(actionIndex) },
      { id: "edit", label: T.menuEdit, click: () => this.beginCapture(InputEventType.KEY, actionIndex, -1) },
      { id: "duplicate", label: T.menuDuplicate, click: () => this.duplicateAction(actionIndex) },
      { id: "sep", type: "separator" },
      { id: "delete", label: T.menuDelete, click: () => this.deleteAction(actionIndex) },
    ]);
    menu.show();
  }

  private showEventMenu(actionIndex: number, eventIndex: number): void {
    const action = (this._data.actions || [])[actionIndex];
    const event = action && action.events ? action.events[eventIndex] : null;
    if (!event) return;
    const menu = IEditor.Menu.create([
      {
        id: "edit",
        label: T.menuEdit,
        click: () => this.beginCapture(this.captureTypeOf(event), actionIndex, eventIndex),
      },
      { id: "duplicate", label: T.menuDuplicate, click: () => this.duplicateEvent(actionIndex, eventIndex) },
      { id: "sep", type: "separator" },
      { id: "delete", label: T.menuDelete, click: () => this.deleteEvent(actionIndex, eventIndex) },
    ]);
    // 默认在鼠标位置弹出，正好落在刚点击的「⋮」按钮旁。
    menu.show();
  }

  private duplicateEvent(actionIndex: number, eventIndex: number): void {
    const action = (this._data.actions || [])[actionIndex];
    const event = action && action.events ? action.events[eventIndex] : null;
    if (!event) return;
    action.events.splice(eventIndex + 1, 0, this.cloneEvent(event));
    this._selectedActionIndex = actionIndex;
    this._selectedEventIndex = eventIndex + 1;
    this._revision++;
  }

  private deleteEvent(actionIndex: number, eventIndex: number): void {
    const action = (this._data.actions || [])[actionIndex];
    const event = action && action.events ? action.events[eventIndex] : null;
    if (!event) return;
    action.events.splice(eventIndex, 1);
    if (this._selectedEventIndex === eventIndex) this._selectedEventIndex = -1;
    this._revision++;
    this.setStatus(`已删除绑定 ${describeEventData(event)}`, false);
  }

  private captureTypeOf(event: InputEventData): InputEventType {
    return event ? (event.type as InputEventType) : InputEventType.KEY;
  }

  /* ------------------------------------------------------------------ */
  /*                          动作重命名                                */
  /* ------------------------------------------------------------------ */

  private beginRename(actionIndex: number): void {
    const action = (this._data.actions || [])[actionIndex];
    if (!action) return;
    this._renamingActionIndex = actionIndex;
    this._selectedActionIndex = actionIndex;
    this._selectedEventIndex = -1;
    this._renameInput.text = action.name;
    this._renameInput.visible = true;
    this.positionRenameOverlay();
    this.focusRenameInput();
  }

  private positionRenameOverlay(): void {
    const models = this.buildRowModels();
    const rowIndex = this.indexOfModel(models, this._renamingActionIndex, -1);
    const width = this._tree.root.width;
    if (rowIndex < 0 || width <= 0) {
      this._renameInput.visible = false;
      this._renamingActionIndex = -1;
      return;
    }
    const rowY = this._tree.root.y + rowIndex * ROW_HEIGHT - this._tree.scrollY;
    this._renameInput.setSize(Math.max(this.actionColumnWidth(width) - ACTION_TEXT_X - 4, 40), ICON_SIZE + 2);
    this._renameInput.setPos(this._tree.root.x + ACTION_TEXT_X, rowY + 1);
  }

  private focusRenameInput(): void {
    try {
      const field: any = this._renameInput.findTextWidget();
      if (field && field.requestFocus) field.requestFocus();
      if (field && field.setSelection) field.setSelection(0, (this._renameInput.text || "").length);
    } catch (error) {
      // 拿不到内部输入框时用户手动点一下即可。
    }
  }

  private commitRename(): void {
    const index = this._renamingActionIndex;
    this._renamingActionIndex = -1;
    this._renameInput.visible = false;

    const actions = this._data.actions || [];
    if (index < 0 || index >= actions.length) return;

    const newName = (this._renameInput.text || "").trim();
    const action = actions[index];
    if (!newName || newName === action.name) return;
    if (actions.some((item, i) => i !== index && item.name === newName)) {
      this.setStatus(`动作名 ${newName} ${T.duplicateSuffix}`, true);
      Editor.showToast(`动作名 ${newName} ${T.duplicateSuffix}`, "warning");
      return;
    }
    const oldName = action.name;
    if (this._collapsed.has(oldName)) {
      this._collapsed.delete(oldName);
      this._collapsed.add(newName);
    }
    action.name = newName;
    // 重命名可能让动作变成（或不再是）内置动作名，选中项要跟着可见性调整。
    this.ensureSelectionVisible();
    this._revision++;
    this.setStatus(`${oldName} → ${newName}`, false);
  }

  /* ------------------------------------------------------------------ */
  /*                           捕获输入                                 */
  /* ------------------------------------------------------------------ */

  private beginCapture(type: InputEventType, actionIndex: number, replaceEventIndex: number): void {
    const action = (this._data.actions || [])[actionIndex];
    if (!action) {
      Editor.showToast(T.needAction, "warning");
      return;
    }
    this._captureType = type;
    this._captureReplace = replaceEventIndex >= 0 ? { actionIndex, eventIndex: replaceEventIndex } : null;
    this.setStatus(replaceEventIndex >= 0 ? T.hintCaptureEdit : T.hintCapture, false);
    document.addEventListener("keydown", this.onCaptureKeyDown, true);
    document.addEventListener("mousedown", this.onCaptureMouseDown, true);
    this.resetGamepadBaseline();
  }

  private cancelCapture(): void {
    if (this._captureType === InputEventType.NONE) return;
    this._captureType = InputEventType.NONE;
    this._captureReplace = null;
    document.removeEventListener("keydown", this.onCaptureKeyDown, true);
    document.removeEventListener("mousedown", this.onCaptureMouseDown, true);
    this.setStatus(T.hintCancelled, false);
  }

  private readonly onCaptureKeyDown = (event: KeyboardEvent): void => {
    if (this._captureType === InputEventType.NONE) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      this.cancelCapture();
      return;
    }
    if (this._captureType !== InputEventType.KEY) return;

    const key = keyFromDomKey(event.key);
    if (key === Key.NONE) return;

    const data = new InputEventData();
    data.type = InputEventType.KEY;
    data.key = keyToString(key);
    this.applyCapturedEvent(data);
  };

  private readonly onCaptureMouseDown = (event: MouseEvent): void => {
    if (this._captureType !== InputEventType.MOUSE_BUTTON) return;
    event.preventDefault();
    event.stopPropagation();

    const data = new InputEventData();
    data.type = InputEventType.MOUSE_BUTTON;
    data.mouseButton =
      event.button === 0 ? MouseButton.LEFT : event.button === 1 ? MouseButton.MIDDLE : MouseButton.RIGHT;
    this.applyCapturedEvent(data);
  };

  private applyCapturedEvent(data: InputEventData): void {
    const replace = this._captureReplace;
    const actionIndex = replace ? replace.actionIndex : this._selectedActionIndex;
    this.cancelCapture();

    const action = (this._data.actions || [])[actionIndex];
    if (!action) {
      Editor.showToast(T.noActionToWrite, "warning");
      return;
    }
    if (!Array.isArray(action.events)) action.events = [];

    if (replace && replace.eventIndex >= 0 && replace.eventIndex < action.events.length) {
      action.events[replace.eventIndex] = data;
      this._selectedEventIndex = replace.eventIndex;
    } else {
      action.events.push(data);
      this._selectedEventIndex = action.events.length - 1;
    }
    this._selectedActionIndex = actionIndex;
    this._collapsed.delete(action.name);
    this._revision++;
    this.setStatus(`${action.name}  ←  ${describeEventData(data)}`, false);
  }

  /* ------------------------------------------------------------------ */
  /*                          手柄捕获                                  */
  /* ------------------------------------------------------------------ */

  private resetGamepadBaseline(): void {
    this._gamepadPrevious = [];
    const pads = this.readGamepads();
    if (!pads) return;
    for (const pad of pads) {
      if (!pad) continue;
      for (let i = 0; i < pad.buttons.length; i++) {
        this._gamepadPrevious[i] = pad.buttons[i].pressed || pad.buttons[i].value > 0.5;
      }
      break;
    }
  }

  private pollGamepadCapture(): void {
    const pads = this.readGamepads();
    if (!pads) return;
    for (const pad of pads) {
      if (!pad) continue;

      if (this._captureType === InputEventType.JOY_BUTTON) {
        for (let i = 0; i < pad.buttons.length; i++) {
          const pressed = pad.buttons[i].pressed || pad.buttons[i].value > 0.5;
          const wasPressed = !!this._gamepadPrevious[i];
          this._gamepadPrevious[i] = pressed;
          if (!pressed || wasPressed) continue;

          const data = new InputEventData();
          data.type = InputEventType.JOY_BUTTON;
          data.joyButton = this.gamepadButtonToJoyButton(i);
          this.applyCapturedEvent(data);
          return;
        }
      } else if (this._captureType === InputEventType.JOY_MOTION) {
        for (let axis = 0; axis < Math.min(pad.axes.length, 4); axis++) {
          const value = pad.axes[axis];
          if (Math.abs(value) < 0.6) continue;
          const data = new InputEventData();
          data.type = InputEventType.JOY_MOTION;
          data.joyAxis = axis;
          data.joyAxisValue = value >= 0 ? 1 : -1;
          this.applyCapturedEvent(data);
          return;
        }
      }
      return;
    }
  }

  private readGamepads(): ReadonlyArray<Gamepad | null> | null {
    const nav: any = typeof navigator !== "undefined" ? navigator : null;
    if (!nav || typeof nav.getGamepads !== "function") return null;
    return nav.getGamepads();
  }

  /** Web Gamepad 标准布局 -> Godot `JoyButton`（与运行时 `Input` 保持一致）。 */
  private gamepadButtonToJoyButton(index: number): number {
    const map: Record<number, number> = {
      0: 0,
      1: 1,
      2: 2,
      3: 3,
      4: 9,
      5: 10,
      8: 4,
      9: 6,
      10: 7,
      11: 8,
      12: 11,
      13: 12,
      14: 13,
      15: 14,
      16: 5,
    };
    return map[index] ?? 0;
  }

  /* ------------------------------------------------------------------ */
  /*                            读写磁盘                                */
  /* ------------------------------------------------------------------ */

  private get relativePath(): string {
    const value = this._pathInput && this._pathInput.text ? this._pathInput.text.trim() : "";
    return (value || DEFAULT_RELATIVE_PATH).replace(/\\/g, "/");
  }

  private assetFullPath(relativePath: string): string {
    const path = IEditor.require("path");
    const assetsPath: string = Editor.assetsPath || "assets";
    const isAbsolute = /^([a-zA-Z]:[\\/]|\/)/.test(assetsPath);
    const base = isAbsolute ? assetsPath : path.join(Editor.projectPath, assetsPath);
    return path.join(base, relativePath);
  }

  async loadFromDisk(verbose: boolean): Promise<void> {
    const relativePath = this.relativePath;
    const fullPath = this.assetFullPath(relativePath);

    let json: any = null;
    try {
      json = IEditor.utils.readJson(fullPath, true);
    } catch (error) {
      json = null;
    }

    this._data = json ? mapDataFromJSON(json) : createDefaultMapData();
    this.selectFirstVisibleAction();
    this._revision++;

    if (json) {
      this.setStatus(`已载入 ${relativePath}`, false);
      if (verbose) Editor.showToast(`已载入 ${relativePath}`, "info");
    } else {
      this.setStatus(`未找到 ${relativePath}，${T.defaultLoaded}`, true);
      if (verbose) Editor.showToast(`未找到 ${relativePath}`, "warning");
    }
  }

  async save(): Promise<void> {
    const relativePath = this.relativePath;
    const text = JSON.stringify(mapDataToJSON(this._data), null, 2);

    try {
      const path = IEditor.require("path");
      const folder = path.dirname(relativePath).replace(/\\/g, "/");
      if (folder && folder !== ".") {
        try {
          await Editor.assetDb.createFolder(folder);
        } catch (error) {
          // 目录已存在时忽略即可。
        }
      }

      const asset = await Editor.assetDb.writeFile(relativePath, text, false, true);
      if (asset) {
        this.setStatus(`已保存 assets/${relativePath}`, false);
        Editor.showToast(`已保存 assets/${relativePath}`, "info");
      } else {
        this.setStatus(`保存失败：${relativePath}`, true);
        Editor.showToast(`保存失败：${relativePath}`, "error");
      }
    } catch (error) {
      this.setStatus(`保存异常：${error}`, true);
      Editor.showToast(`保存异常：${error}`, "error");
    }
  }
}
