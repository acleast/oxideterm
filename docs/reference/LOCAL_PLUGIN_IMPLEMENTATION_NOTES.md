# Local Plugin Implementation Notes

本文记录本次为 OxideTerm 编写本地插件的实现方法，供后续 Codex 会话继续开发插件时直接读取。

## 插件位置

本次实现的插件是 `command-history-autocomplete`，当前开发环境路径：

```text
/home/user/.oxideterm/plugins/command-history-autocomplete/
  plugin.json
  main.js
```

用户实际运行 OxideTerm 的环境是 Windows，插件需要放到：

```text
C:\Users\<用户名>\.oxideterm\plugins\command-history-autocomplete\
  plugin.json
  main.js
```

OxideTerm 只扫描运行环境自己的 `~/.oxideterm/plugins/`，Linux 开发环境下生成的插件不会被 Windows 安装版自动加载。

## 使用到的插件 API

核心 API：

- `ctx.terminal.registerInputInterceptor(handler)`：同步拦截用户输入，必须在 `plugin.json` 中声明 `contributes.terminalHooks.inputInterceptor: true`。
- `ctx.terminal.writeToNode(nodeId, text)`：向指定 SSH 节点写入文本。
- `ctx.terminal.writeToActive(text)`：向当前活跃终端写入文本，主要用于没有 `nodeId` 的本地终端。
- `ctx.storage.get/set/remove`：插件作用域持久化存储。
- `ctx.ui.registerStatusBarItem()`：显示历史数量或匹配状态。
- `ctx.ui.registerCommand()`：注册命令面板操作，例如清空历史。
- `ctx.ui.showToast()`：加载成功、清空成功等提示。

Manifest 示例：

```json
{
  "id": "command-history-autocomplete",
  "main": "./main.js",
  "contributes": {
    "terminalHooks": {
      "inputInterceptor": true
    }
  }
}
```

## 命令历史补全插件实现逻辑

历史存储 key：

```js
const STORAGE_KEY = 'commands';
ctx.storage.set(STORAGE_KEY, history.slice(0, MAX_HISTORY));
```

历史数据只存在 OxideTerm 插件本地存储里，不是远端 shell 的 `~/.bash_history`。

输入处理规则：

- 每个 `sessionId` 维护独立状态：`line`、`nodeId`、`browsePrefix`、`browseMatches`、`browseIndex`。
- 普通可打印字符追加到当前行。
- `Backspace` 删除当前行最后一个字符。
- `Ctrl+C` / `Ctrl+U` 清空当前行状态。
- `Enter` / `\r` / `\n` 时记录当前命令。
- 命令会 `trim` 并压缩连续空白；空命令不记录。
- 历史去重，重复命令移动到最新位置。
- 历史上限当前为 500 条。

上下键行为：

- `Up` 的输入序列是 `\x1b[A`。
- `Down` 的输入序列是 `\x1b[B`。
- 当前行非空时，`Up` 会查找以当前前缀开头的历史命令，并返回 `null` 阻止方向键发给远端。
- 选中历史项后，通过 `Ctrl+U + command` 替换当前 shell 输入行。
- 当前行为空时，不拦截 `Up`，保留 shell 自带历史行为。

手动触发入口：

- 为了便于排查“插件加载了但 Up/Down 没反应”的情况，当前插件也按 `securecrt-recorded-script` 的写法注册了显式入口。
- 当前版本不要调用 `ctx.terminal.registerShortcut()`；该 API 要求 `plugin.json` 的 `contributes.terminalHooks.shortcuts` 同步声明，Windows 端文件不同步时会导致加载失败：`Shortcut command "..." not declared in manifest`。
- `activate(ctx)` 中注册：
  - `ctx.ui.registerKeybinding('ctrl+shift+h', runtime.cycleFromActive)`
  - 命令面板命令 `Cycle Command History Completion`
- 手动触发时允许空前缀，会直接在最近历史命令中循环；这比只依赖 Up/Down 更容易确认插件是否生效。快捷键是 `Ctrl+Shift+H`。
- DevTools Console 可按 `[command-history-autocomplete]` 过滤日志。

## 注意事项

- `inputInterceptor` 是同步热路径，不要做异步请求或重计算。
- 该方案依赖 bash/zsh/readline 常见行为：`Ctrl+U` 清空当前输入行。全屏 TUI、vim、top、REPL、多行命令和非 readline shell 中可能不准确。
- 插件没有终端内联浮层 API，因此当前实现不是灰色 ghost text，而是按 `Up/Down` 后直接回填命令。
- 当前源码中 SSH `TerminalView` 已调用 `runInputPipeline`，但 `LocalTerminalView` 没有接入插件 input pipeline。因此自动记录/Up-Down 拦截主要适用于 SSH 终端；本地终端要完整支持需要改核心。
- 如果要支持更接近 IDE 的补全 UI，需要改 OxideTerm 核心，暴露终端 overlay 或 Command Bar 扩展点。
- 历史可能包含 token、密码或一次性密钥。后续应增加敏感命令过滤，例如跳过包含 `password`、`token`、`secret`、`sshpass`、`export .*KEY=` 的输入。
- 插件安装到 Windows 后，在 Plugin Manager 中 Refresh/Reload；加载成功应看到 toast。
- 调试日志看 DevTools Console，或 Plugin Manager 的插件日志视图。

## 后续开发步骤模板

1. 在目标运行环境创建 `~/.oxideterm/plugins/<plugin-id>/`。
2. 编写 `plugin.json`，只声明实际使用的 hooks、tabs、sidebar panels 或 settings。
3. 在 `main.js` 导出 `activate(ctx)`；需要清理时导出 `deactivate()`。
4. 先用 `console.info('[plugin-id]', ...)` 加可过滤日志。
5. 在 OxideTerm Plugin Manager 中 Refresh/Reload。
6. 打开 DevTools Console 验证插件是否加载和事件是否触发。
7. 再补充命令面板入口、状态栏、设置项和错误提示。

## `alt-number-tabs` 插件说明

当前插件路径：

```text
/home/user/.oxideterm/plugins/alt-number-tabs/
  plugin.json
  main.js
```

问题原因：

- 插件最初调用了 `ctx.ui.activateTab(index)`。
- 当前 `plugin-api.d.ts` 的 `ctx.ui` 没有 `activateTab` 方法，只提供 `openTab(tabId)` 用于打开插件自己声明的 tab，以及 `getLayout()` 读取布局。
- 因此插件会提示 `ctx.ui.activateTab is not available`，不会注册真正的 Alt+数字切换逻辑。

当前修复策略：

- 不再调用不存在的 `activateTab`。
- 注册 `ctx.ui.registerKeybinding('alt+1' ... 'alt+9')`。
- 触发后派发宿主已有默认快捷键：
  - Windows/Linux：模拟 `Ctrl+1` ... `Ctrl+9`
  - macOS：模拟 `Cmd+1` ... `Cmd+9`
- 宿主已有 `app.goToTab1` ... `app.goToTab9`，见 `src/lib/keybindingRegistry.ts`。
- DevTools Console 可按 `[alt-number-tabs]` 过滤日志。

注意：

- 这是一个桥接实现，不是正式插件 API。若用户自定义了宿主 tab 快捷键，模拟默认 `Ctrl/Cmd+数字` 可能不跟随自定义配置。
- 更稳的长期方案是在插件 API 中新增类似 `ctx.ui.activateAppTab(index)` 或 `ctx.ui.goToTab(index)` 的官方方法。

## `confirm-app-close` 插件说明

当前插件路径：

```text
/home/user/.oxideterm/plugins/confirm-app-close/
  plugin.json
  main.js
```

目标：

- 关闭 OxideTerm 窗口或退出程序时进行二次确认，降低误关闭风险。

实现方式：

- 第一版只注册了 `window.addEventListener('beforeunload', handler)`，但 Windows Tauri 环境可能不会用它拦截窗口关闭。
- 当前版本优先动态导入 Tauri window API：

```js
const { getCurrentWindow } = await import('@tauri-apps/api/window');
const appWindow = getCurrentWindow();
const unlisten = await appWindow.onCloseRequested(async (event) => {
  event.preventDefault();
  const confirmed = await ctx.ui.showConfirm(...);
  if (confirmed) await appWindow.close();
});
```

- 调用 `appWindow.close()` 前用 `allowNextClose` 标记，避免再次进入确认循环。
- `beforeunload` 仍保留为兜底。handler 中调用：

```js
event.preventDefault();
event.returnValue = '';
return '';
```

- 插件注册了 setting：`enabled`，默认 `true`。
- 插件注册状态栏项显示 `Close confirm: on/off`。
- 插件注册命令面板命令 `Toggle Close Confirmation`，用于临时开关。
- `deactivate()` 必须移除 `beforeunload` 监听、dispose settings listener，并调用 Tauri close listener 的 unlisten，避免插件热重载后叠加多个监听器。

限制：

- `@tauri-apps/api/window` 不是当前官方插件 API；这是同 JS 上下文下的直接导入方案。如果未来插件沙箱化，需要由宿主暴露正式 close-requested API。
- `beforeunload` 的确认文案通常由浏览器/WebView 控制，插件不能可靠自定义按钮或内容；Tauri close-requested + `ctx.ui.showConfirm()` 可以自定义 OxideTerm 内部确认框。
- 如果需要完全可控的关闭确认弹窗，长期方案是在宿主核心接入 Tauri window close requested 事件，并暴露插件 API 或做成内置设置。

相关代码参考：

- 插件 API 类型：`plugin-api.d.ts`
- 插件开发文档：`PLUGIN_DEVELOPMENT.md`
- 终端 hook 实现：`src/lib/plugin/pluginTerminalHooks.ts`
- 插件上下文实现：`src/lib/plugin/pluginContextFactory.ts`
