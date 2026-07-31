# 终端快捷按钮插件方案

> **目标**: 让用户在终端底部快速点击按钮发送常用命令，补足当前折叠式快捷命令面板的操作效率。
> **结论**: 现有插件能力可以先做出“底部按钮条”版本；若要真正嵌入当前终端命令栏，则需要补宿主插槽。

---

## 1. 背景

当前 OxideTerm 已有以下能力：

- 插件可注册底部状态栏项
- 插件可向活动终端写入文本
- 原生终端命令栏已经承载了广播、录制、分屏、快捷命令等能力

但现状也有一个明显问题：

- 快捷命令入口是折叠式的，频繁使用时不够顺手
- 目前没有公开的“命令栏按钮插槽”

因此，用户想要的 SecureCRT 风格按钮栏，最现实的第一步是由插件提供一组可点击按钮。

---

## 2. 目标

1. 允许用户把常用命令做成按钮
2. 按钮点击后直接发送到当前活动终端
3. 支持按连接/主机条件显示不同按钮组
4. 保持插件可卸载、可禁用、可扩展

---

## 3. 现状能力

### 3.1 已有能力

- `ctx.ui.registerStatusBarItem(...)`
- `ctx.terminal.writeToActive(text)`
- `ctx.terminal.writeToNode(nodeId, text)`
- `ctx.ui.showConfirm(...)`
- `ctx.ui.showToast(...)`

### 3.2 已有宿主界面

终端底部当前由 `TerminalCommandBar` 负责，包含：

- 快捷命令
- 广播输入
- 录制
- 分屏
- 其他终端动作

插件目前只能通过状态栏插入自己的项，不能直接插到这条命令栏内部。

---

## 4. 方案分层

### 4.1 方案 A: 仅用现有插件 API

插件在底部状态栏增加一个按钮组，点击后发送命令到当前活动终端。

**优点**

- 无需改宿主核心 UI
- 开发快
- 风险低

**限制**

- 位置在最底部状态栏，不是在原生命令栏中
- 无法获得“当前右键 tab / 当前命令栏上下文”的更细粒度信息

### 4.2 方案 B: 宿主新增命令栏插槽

宿主提供 `registerCommandBarButton` 或类似 API，让插件把按钮插进终端底部命令栏。

**优点**

- 体验最接近 SecureCRT
- 可与广播、录制、分屏按钮并列
- 后续可做分组、折叠、上下文显示

**限制**

- 需要改宿主组件和插件 API
- 需要处理布局、权限、上下文传递

---

## 5. 推荐路线

### 阶段 1: 先做状态栏版

实现一个插件，例如“Quick Buttons”：

- 在状态栏渲染按钮
- 点击发送预定义命令
- 支持当前终端/指定 node 两种目标
- 支持确认开关、执行后 toast

这一步可以快速验证需求。

### 阶段 2: 再补命令栏插槽

若状态栏版被频繁使用，再给宿主加原生命令栏插槽：

- `ctx.ui.registerCommandBarButton(...)`
- 支持左侧/右侧分组
- 支持 `when(context)` 条件显示
- 支持 `onClick(context)` 获取当前 terminal / node / tab 信息

---

## 6. 建议的插件能力

### 6.1 按钮定义

每个按钮建议支持：

- `label`
- `icon`
- `tooltip`
- `command`
- `target`
- `autoEnter`
- `confirm`
- `when`

### 6.2 目标类型

- `active`: 当前活动终端
- `node`: 指定节点
- `broadcast`: 广播到当前广播目标

### 6.3 行为选项

- 仅发送文本
- 发送后补回车
- 发送前确认
- 发送后高亮提示

---

## 7. 交互建议

按钮栏建议按场景分组：

- 常用运维命令
- 只读检查命令
- 危险命令
- 当前项目专用命令

按钮数量不要无限增长，建议：

- 常驻显示 5 到 8 个
- 其余放入下拉组
- 支持按主机名、标签、连接类型过滤

---

## 8. 宿主侧需要补的能力

如果要做成真正的内嵌命令栏，需要宿主补这些点：

1. 命令栏按钮插槽 API
2. 把当前 tab / session / node 上下文传给插件
3. 支持按钮按上下文隐藏或禁用
4. 给插件按钮提供统一样式和尺寸

---

## 9. 风险与注意事项

- 插件直接发送命令有误操作风险
- 需要提供确认开关
- 对敏感命令要有视觉区分
- 广播场景要避免误发到所有目标
- 插件按钮要支持卸载清理

---

## 10. 结论

**能做，但分两步。**

- **现在就能做**: 用插件状态栏做快捷按钮
- **更理想的形态**: 宿主新增命令栏插槽，让插件把按钮放进底部操作区

如果目标是“先让快捷输入好用起来”，建议先落地阶段 1。
如果目标是“像 SecureCRT 一样常驻按钮栏”，建议阶段 1 和阶段 2 都做。

---

## 11. 可开发任务清单

### 11.1 阶段 1: 插件状态栏快捷按钮

这一阶段不改宿主核心 API，只基于现有插件能力实现一个可用原型。

#### 任务 1: 定义插件配置格式

**目标**

定义按钮、按钮组和发送行为的数据结构。

**建议配置**

```json
{
  "groups": [
    {
      "id": "basic",
      "label": "Basic",
      "buttons": [
        {
          "id": "ls",
          "label": "ls",
          "icon": "List",
          "command": "ls -la",
          "autoEnter": true,
          "confirm": false
        }
      ]
    }
  ]
}
```

**验收标准**

- 支持多个按钮组
- 每个按钮有稳定 `id`
- 支持 `autoEnter`
- 支持 `confirm`
- 支持空配置时加载默认按钮

#### 任务 2: 创建 Quick Buttons 插件骨架

**目标**

创建一个插件目录和最小入口。

**建议文件**

- `plugin.json`
- `index.js`
- `README.md`

**验收标准**

- 插件能被 OxideTerm 发现
- 插件启用后不报错
- 插件禁用后能清理注册的状态栏项

#### 任务 3: 注册状态栏按钮

**目标**

用 `ctx.ui.registerStatusBarItem(...)` 把按钮显示到底部插件状态栏。

**核心行为**

- 每个按钮注册一个 status bar item
- 点击按钮时发送命令
- 按钮 tooltip 显示完整命令

**验收标准**

- 底部能看到按钮
- 点击按钮会触发回调
- 插件卸载后按钮消失

#### 任务 4: 实现发送到当前活动终端

**目标**

点击按钮时调用 `ctx.terminal.writeToActive(...)`。

**发送规则**

- `autoEnter: true` 时发送 `${command}\r`
- `autoEnter: false` 时只发送 `${command}`
- 当前没有活动终端时给出 toast

**验收标准**

- 当前 SSH 终端可收到命令
- 当前本地终端可收到命令
- 无活动终端时不会抛异常

#### 任务 5: 增加确认和提示

**目标**

减少误触风险。

**行为**

- `confirm: true` 时先调用 `ctx.ui.showConfirm(...)`
- 发送成功后可选 toast
- 发送失败时显示错误 toast

**验收标准**

- 需要确认的按钮不会直接执行
- 用户取消后不发送命令
- 发送失败有清晰提示

#### 任务 6: 支持 host/node 条件显示

**目标**

按当前连接上下文过滤按钮。

**当前可行方式**

- 调用 `ctx.terminal.getActiveTarget()`
- 根据 active target 的 `nodeId` 或连接状态决定是否发送

**限制**

现有 `registerStatusBarItem` 没有 `when(context)`，所以状态栏项不能天然按上下文自动隐藏。第一版可以在点击时判断，或通过 `onLayoutChange` / 定时刷新更新按钮文本。

**验收标准**

- 不匹配当前终端时按钮不执行
- 给出“当前终端不适用”的提示

#### 任务 7: 增加插件内配置管理

**目标**

让用户不用改代码也能管理按钮。

**可选路径**

- 第一版用插件 `ctx.storage` 保存 JSON
- 后续增加插件 Tab View 或 Sidebar Panel 做配置 UI

**验收标准**

- 按钮配置可持久化
- 重启应用后配置仍然存在
- 配置 JSON 无效时回退默认值

### 11.2 阶段 2: 宿主命令栏插件插槽

这一阶段改宿主，让插件按钮能进入原生底部命令栏。

#### 任务 8: 设计 Command Bar 插槽 API

**目标**

新增正式插件 API。

**建议类型**

```ts
export type TerminalCommandBarContext = {
  paneId: string;
  tabId: string;
  sessionId: string;
  terminalType: 'terminal' | 'local_terminal';
  nodeId?: string | null;
  connectionId?: string | null;
  isActive: boolean;
};

export type CommandBarButtonOptions = {
  id: string;
  label: string;
  icon?: string;
  tooltip?: string;
  group?: string;
  priority?: number;
  when?: (context: TerminalCommandBarContext) => boolean;
  onClick: (context: TerminalCommandBarContext) => void | Promise<void>;
};
```

**验收标准**

- API 类型写入 `plugin-api.d.ts`
- 内部类型同步到 `src/types/plugin.ts`
- API 命名稳定，能兼容后续分组和下拉菜单

#### 任务 9: 在 pluginStore 增加 registry

**目标**

保存插件注册的 command bar buttons。

**建议数据**

- `commandBarButtons: Map<string, CommandBarButtonEntry>`
- key 使用 `pluginId:buttonId`

**涉及文件**

- `src/store/pluginStore.ts`

**验收标准**

- 插件注册后 store 有记录
- 插件停用后记录被清理
- 重复 id 不污染其他插件

#### 任务 10: 在 pluginContextFactory 暴露注册方法

**目标**

实现 `ctx.ui.registerCommandBarButton(...)`。

**涉及文件**

- `src/lib/plugin/pluginContextFactory.ts`

**验收标准**

- 注册成功返回 Disposable
- dispose 后按钮消失
- 插件异常不会影响宿主

#### 任务 11: 在 TerminalCommandBar 渲染插件按钮

**目标**

把插件按钮渲染到原生命令栏动作区。

**涉及文件**

- `src/components/terminal/TerminalCommandBar.tsx`
- `src/lib/plugin/pluginIconResolver.ts`

**渲染规则**

- 使用现有命令栏按钮样式
- 支持图标
- 支持 tooltip
- 按 `priority` 排序
- `when(context)` 返回 false 时隐藏

**验收标准**

- 插件按钮与原生命令栏视觉一致
- 当前终端切换后按钮能按上下文更新
- 插件按钮点击能拿到正确 `paneId / sessionId / nodeId`

#### 任务 12: 增加上下文安全边界

**目标**

避免插件拿到可变内部对象。

**要求**

- 传给插件的 context 使用只读快照
- 不暴露 store 引用
- 插件回调包 try/catch

**验收标准**

- 插件修改 context 不影响宿主
- 插件抛错时只记录日志，不破坏命令栏

#### 任务 13: 增加测试

**目标**

覆盖注册、渲染、点击和卸载。

**建议测试**

- pluginStore 注册和清理
- pluginContextFactory 注册 API
- TerminalCommandBar 渲染按钮
- `when(context)` 过滤
- `onClick(context)` 传参

**验收标准**

- 新增测试通过
- 既有 TabBar / TerminalCommandBar 测试不回归

### 11.3 阶段 3: 原生快捷按钮体验增强

这一阶段不一定必须做，但能把体验做完整。

#### 任务 14: 按钮组和下拉菜单

**目标**

避免底部按钮太多。

**验收标准**

- 支持常驻按钮
- 支持更多按钮折叠到下拉菜单
- 移动或窄窗口下不挤压输入框

#### 任务 15: 广播发送支持

**目标**

按钮可选择发送到广播目标。

**需要补充**

- 当前插件 API 不能直接调用广播目标发送
- 可新增 `ctx.terminal.writeToBroadcast(text)` 或宿主内置按钮行为

**验收标准**

- 广播开启时可发送到目标终端
- 广播关闭时给出提示
- 不会误发到非目标终端

#### 任务 16: 快捷命令复用

**目标**

复用现有 Quick Commands 数据，而不是维护两套命令。

**可选实现**

- 暴露只读 quick commands 快照给插件
- 或宿主原生命令栏直接增加“固定到按钮栏”

**验收标准**

- 用户可以把已有快捷命令固定为按钮
- 修改快捷命令后按钮同步更新

---

## 12. 建议开发顺序

1. 完成阶段 1 的插件原型
2. 用真实运维命令试用 1 到 2 天
3. 确认按钮数量、位置、分组是否符合习惯
4. 再做阶段 2 的宿主插槽
5. 最后考虑广播发送和快捷命令复用

---

## 13. 最小可交付版本

最小可交付版本只需要完成：

- 任务 1: 定义插件配置格式
- 任务 2: 创建插件骨架
- 任务 3: 注册状态栏按钮
- 任务 4: 发送到当前活动终端
- 任务 5: 增加确认和提示

完成后即可实现：

- 底部出现一排快捷按钮
- 点击按钮发送常用命令
- 可配置是否自动回车
- 危险命令可二次确认

