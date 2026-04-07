# Window Drag Contract

本文件定义桌面端窗口拖拽区域的长期约束，避免出现“某些空白区可拖、某些不可拖”的回归。

## 目标

- 任意顶层列布局中，拖拽语义一致。
- 空态、加载态、错误态都保留可拖拽能力。
- 交互控件始终不被 `drag-region` 吞掉点击。

## 统一规则

1. 顶层容器不要加 `drag-region`。
2. 顶栏条优先使用 `WindowDragStrip`；整块头部容器使用 `DragRegionContainer`。
3. 可交互元素（按钮、输入框、滚动列表）必须处于 `no-drag` 区域。
4. 空态/加载态/占位态也要渲染 `WindowDragStrip`。
5. 优先使用 class（`drag-region` / `no-drag`），不要再新增内联 `WebkitAppRegion`。
6. `drag-region` 必须禁用文本选择（`user-select: none`），避免拖拽误选中文本。
7. 拖拽区禁止挂自定义 `contextmenu` 行为（遵循 Electron 官方建议）。
8. `drag` / `no-drag` 重叠时按“上层元素优先”设计层级，不依赖历史 macOS 特例行为。

例外：像 `TabBar` 这种组件本身就是单层顶栏条带时，根节点可直接为 `drag-region`，但所有交互控件必须 `no-drag`。

## 推荐结构

```tsx
<div data-surface-root className="... flex flex-col">
  <WindowDragStrip className="..." />
  <div className="flex-1 no-drag">
    {/* interactive content */}
  </div>
</div>
```

## 反模式

- 在整个列容器上直接加 `drag-region`。
- 在滚动列表容器上加 `drag-region`。
- 只在“正常态”渲染拖拽条，空态或 loading 漏掉。
- 交互按钮未加 `no-drag`，导致点击被拖拽行为抢占。
- 在 `drag-region` 上绑定自定义 `onContextMenu`。

## 测试约束

新增或重构列布局时，至少覆盖以下断言：

1. 根容器不包含 `drag-region`。
2. 顶部第一层条带包含 `drag-region`。
3. 主滚动区或关键交互控件包含 `no-drag`。
4. 至少一个空态或加载态存在 `drag-region`（通过 `data-testid` 断言）。

可复用 `src/renderer/src/components/__tests__/dragRegionContract.ts` 中的 helper：

- `expectHeaderOnlyDragRegion`
- `expectNoDragControl`
- `expectRootDragRegion`
- `expectDragRegionElement`

并通过静态守卫测试防止在 TSX 中回退到内联 app-region：

- `src/renderer/src/components/__tests__/dragRegionStaticGuard.test.ts`
- `src/renderer/src/components/__tests__/dragRegionCssAllowlist.test.ts`（约束 `-webkit-app-region` 仅出现在 allowlist 文件，并允许持续减量）
  - 当前 allowlist: `src/renderer/src/styles/index.css`
- `src/renderer/src/components/__tests__/dragRegionGlobalStyleContract.test.ts`（锁定 `.drag-region/.no-drag` 与全局 app-region 映射）
  - 同时锁定 `drag-region` 的 `user-select: none`
- `src/renderer/src/components/__tests__/dragRegionClassUsageAllowlist.test.ts`（约束直接 `className` 写 `drag-region` 的例外文件）
  - 当前例外: 无（0 文件）
- `src/renderer/src/components/__tests__/dragRegionTokenUsageAllowlist.test.ts`（AST 级约束：业务 TSX 中独立 `drag-region` token 仅允许在 `DragRegionContainer` / `WindowDragStrip`）
- `src/renderer/src/components/__tests__/dragRegionContextMenuGuard.test.ts`（禁止在 `DragRegionContainer` / `WindowDragStrip` 上声明 `onContextMenu`，包含 import alias 场景）
- `src/renderer/src/components/__tests__/EditorEmptyStateDragContract.test.tsx`（锁定右侧空白编辑态 `note=null` 时顶栏可拖拽）
- `eslint.config.mjs` `no-restricted-syntax`（开发阶段禁止在 `DragRegionContainer` / `WindowDragStrip` 上声明 `onContextMenu` / `onContextMenuCapture`）
- 推荐本地校验命令：`npm run verify:drag-contract`
- CI 工作流：`.github/workflows/drag-contract.yml`（PR / main push 自动执行）

## 当前落地点

- `WindowDragStrip` 组件：`src/renderer/src/components/WindowDragStrip.tsx`
- `DragRegionContainer` 组件：`src/renderer/src/components/DragRegionContainer.tsx`
- 典型页面：`Sidebar` / `NoteList` / `LocalFolderNoteList` / `TrashList` / `TabBar` / `App` 空态分支

这份 contract 是长期约束，后续如有特殊场景偏离，需要在 PR 中明确说明原因和替代保障。

## 参考

- Electron 官方: [Custom Window Interactions](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions)
- Electron 官方: [Breaking Changes（Electron 23 draggable region 行为统一）](https://www.electronjs.org/docs/latest/breaking-changes/)
