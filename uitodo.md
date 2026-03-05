# 前端重构倒排计划 (UI Refactoring Plan)

## 核心目标
1. **工程化初步**: 将内联的 CSS 和 JS 从 `index.html` 彻底剥离到专门的 `static/css/style.css` 和 `static/js/app.js` 文件中。
2. **引入现代 UI 框架**: 以零构建 (Zero-build) 方式引入 Tailwind CSS + DaisyUI (CDN)，适合在树莓派直接运行而无需 Node.js 编译。
3. **彻底替换旧样式**: 使用 DaisyUI 提供的语义化组件（Card, Button, Tabs, Collapse, Modal, Toast 等）彻底替换原有手写硬编码的 CSS。目标是移除90%以上的自定义样式。
4. **API 调用全面现代化**: 彻底废弃旧的 `<form action="..." method="POST">` 同步提交导致页面刷新的方式。全面采用现代 `fetch` (异步请求) 机制，实现无刷新页面更新、优雅的错误处理和 Loading 状态管理。

---

## 阶段一：基础重构与文件拆分 (文件物理隔离)
- [x] **1.1 目录结构规划**: 在项目中创建 `static/`、`static/css/`、`static/js/` 目录存放静态资源。
- [x] **1.2 剥离 CSS**: 将 `index.html` 中庞大的 `<style>` 标签内容整体移动到 `static/css/style.css`，并在 HTML `<head>` 引入。
- [x] **1.3 剥离 JS**: 将 `<script>` 标签内的业务逻辑全部移动到 `static/js/app.js`，并在 HTML 底部引入。
- [x] **1.4 模板变量清理**: 解决分离 JS 后服务端渲染变量（如 `{{ variable }}`）丢失的问题，将服务端注入的基础数据转换为注入到 `window.APP_CONFIG` 或特定 DOM 的 `data-*` 属性中，实现前后端逻辑完全解耦。

## 阶段二：引入底层框架与核心布局重构
- [x] **2.1 引入 CDN**: DaisyUI 5 (`daisyui@5/daisyui.css`) + Tailwind CSS v4 Browser (`@tailwindcss/browser@4`) 已加入 `<head>`。
- [x] **2.2 配置全局主题 (Tailwind/DaisyUI)**: 自定义 `rascon` 暗色主题，使用 oklch 色值精确映射原有色彩体系；`<html data-theme="rascon">` 激活。
- [x] **2.3 布局骨架重写**: Header (`flex items-center justify-between`)、Main Grid (`grid grid-cols-[1fr_560px]`)、Left/Right sections (`flex flex-col`)、Footer 均已用 Tailwind 实用类重写，含 `max-[1200px]:` 响应式断点。
- [x] **2.4 删减全局默认值**: 已移除 `style.css` 中 `*`/`body`/`.container`/`header`/`.main-content`/`.left-section`/`.right-section`/`.header-status`/`.quick-actions`/`footer` 布局规则；保留 `:root` 变量、`.logo` 视觉样式、滚动条样式及组件级媒体查询。

## 阶段三：网络通信 API 化改造
- [x] **3.1 核心 HTTP 封装**: `api` 对象 (`api.get()` / `api.post()`) 封装于 `app.js` 顶部，自动处理 JSON 序列/反序列化、HTTP 状态码判断、`success === false` 业务错误抛出，支持 `FormData` 文件上传。全文件仅保留 1 处 `fetch()` 调用（在 `api.request` 内部）。
- [x] **3.2 全局 Loading & Toast 通知**: `UI` 对象 (`UI.success()` / `UI.error()` / `UI.info()` / `UI.warning()`) 基于 DaisyUI `alert` 组件 + Tailwind 过渡动画实现，支持多条同时显示、自动消失。HTML 中 `<div class="toast toast-end toast-bottom">` 替代旧 `#toast`，旧手写 toast CSS（37 行）已移除。保留 `showToast()` 作为一行薄包装兼容层。
- [x] **3.3 表单全面拦截**: 当前 `index.html` 中零 `<form>` 元素，全部 19 处 `fetch` 调用已统一为 `api.post/get`。后端移除 6 条遗留 form 路由（`/bluez`、`/btn`、`/script/run`、`/script/stop`、`/amiibo/upload`、`/raspi`），仅保留 `/`（首页）和 `/amiibos`（批量功能页）。`app.js` 1180→1017 行（-14%）。

## 阶段四：UI 组件级深度替换 (核心攻坚)
- [x] **4.1 HTML DaisyUI 组件全面替换**:
  - Header: `.logo`/`.logo-icon`/`.logo-text` → Tailwind `flex items-center gap-3` + 渐变色块 + `text-primary`。连接按钮 `btn-accent`→`btn btn-primary btn-sm`，断开按钮 `btn-danger`→`btn btn-error btn-sm`。状态指示改为 `flex items-center gap-2 ml-2` + `text-xs text-base-content/50`。
  - Controller Panel: `.panel`→`card bg-base-200 border border-base-300`，`.panel-header`→Tailwind flex 组合，全屏按钮→`btn btn-ghost btn-xs`。
  - Amiibo Panel: `.panel`→DaisyUI `card`，`.amiibo-tabs`→`tabs tabs-box tabs-sm` + `tab`/`tab-active`，`.amiibo-search-input`→`input input-bordered input-sm`，工具栏按钮→`btn btn-ghost btn-sm`，上传→`btn btn-primary btn-sm`。
  - Detail Actions: `btn-accent`→`btn-primary`，plain `btn`→`btn-ghost`，`btn-danger`→`btn-error`。移除按钮→`btn btn-error btn-xs`。
  - Subscription View: 由 CSS `display:none` 改为 Tailwind `hidden` class + JS `style.display` 切换。Inputs 全部使用 DaisyUI `input input-bordered input-sm`。`#repo-content` 使用 Tailwind `flex-1 overflow-y-auto border rounded-lg bg-base-300 p-2`。
  - Script Panel: `.panel`→DaisyUI `card`，`textarea`→`textarea textarea-bordered flex-1 min-h-[80px] resize-none font-mono text-xs`，运行按钮→`btn btn-primary btn-sm flex-1`，清空→`btn btn-ghost btn-sm`。
- [x] **4.2 CSS 大幅精简 (1500→791 行，-47%)**:
  - 移除所有旧组件样式：`.logo*`、`.panel*`、`.panel-badge`、`.status-indicator`、`.status-text`、通用 `.btn*`(`.btn`/`.btn-sm`/`.btn-lg`/`.btn-accent*`/`.btn-danger*`)、`.script-panel`/`.script-container*`/`.script-row*`/`.btn-run*`/`.btn-stop*`、`.amiibo-library`、`.amiibo-toolbar`、`.amiibo-search-input*`、`#repo-content`、`#script-form`/`#script-area*`/`.script-actions`/`.script-header*`/`.btn-flex`、`.amiibo-tabs*`、`.amiibo-search*`/`.amiibo-content`/`.amiibo-tree*`/`.tree-node*`、`.amiibo-list`(旧)、`.amiibo-upload*`、`.amiibo-footer`、`.external-library*`、`.repo-toolbar-hidden`、`#amiibo-subscription-view { display:none }`、`.detail-actions .btn { flex:1 }`、重复定义的 `.current-amiibo-status` 和 `.empty-state`。
  - **BUG FIX**: `.btn-pressed`→`.pressed`（JS 使用 `classList.add('pressed')` 但旧 CSS 定义 `.btn-pressed`，控制器按键视觉反馈从未生效！现已修复）。
  - **FIX**: `.fullscreen-active .left-section .panel`→`.controller-panel`（匹配新 HTML class）。
  - 保留：`:root` 变量、`.status-dot*`、`@media (max-width:1200px)` 组件规则、控制器网格/按钮类型/`.pressed`、全屏模式、侧边栏面板、Amiibo 内容分栏/列表项/详情/版本、树组/订阅文件、状态类、页脚、滚动条。
- [x] **4.3 JS 类名同步更新**:
  - `switchAmiiboTab()`: `.amiibo-tabs button`→`[role="tablist"] .tab`，`active`→`tab-active`。
  - `updateScriptButton()`: `btn-danger`→`btn-error`，`btn-accent`→`btn-primary`，`btn-flex`→`flex-1`。
  - `toggleGroupMode()`: `btn.style.color/borderColor`→`btn.classList.toggle('btn-active', isGroupMode)` (DaisyUI 状态类)。
  - `renderRepoFiles()`: `repo-toolbar-hidden` class→`style.display` 属性切换，下载按钮→`btn btn-primary btn-sm`。
  - 移除孤立 CSS `.repo-file-item .btn-download`。

## 阶段五：旧代码彻底大扫除
- [x] **5.1 CSS `:root` 变量全面迁移**:
  - 删除整个 `:root` 块 (17 个硬编码色值)，在 `[data-theme=\"rascon\"]` 主题中追加 4 个 DaisyUI 未提供的补充色阶: `--color-border`、`--color-border-accent`、`--color-muted`、`--color-subtle` (oklch 格式)。
  - style.css 全文 ~60 处 `var(--bg-*)` / `var(--text-*)` / `var(--accent-*)` / `var(--danger)` / `var(--info)` 等旧变量名 → 对应 DaisyUI `var(--color-*)` 主题变量。映射表:
    - `--bg-primary` → `--color-base-100`，`--bg-secondary` → `--color-base-200`，`--bg-tertiary` → `--color-base-300`，`--bg-card` → `--color-neutral`
    - `--text-primary` → `--color-base-content`，`--text-secondary` → `--color-muted`，`--text-muted` → `--color-subtle`
    - `--accent-primary` → `--color-primary`，`--accent-secondary` → `--color-secondary`
    - `--danger` → `--color-error`，`--warning` → `--color-warning`，`--info` → `--color-info`，`--success` → `--color-success`
  - 791→760 行 (−4%)，**零旧变量残留**，全文经 `grep` 验证无任何 `var(--bg-|--text-|--accent-|--danger|--info|--warning)` 遗漏。
- [x] **5.2 JS 废弃代码清洗**:
  - 移除 `showToast()` 向后兼容层 (阶段 3 遗留)。
  - 移除不存在的 `#status-message` DOM 引用 (`updateStatus()`)。
  - 3 处 JS 内联 HTML 中的旧 `var(--text-muted)` / `var(--info)` → 新主题变量名。
  - 2 处 `fetchRepoTree()` 内联 `style=\"padding/text-align\"` → 复用已有 `.empty-state` / `.error-state` 类。
- [x] **5.3 DaisyUI 确认对话框 (替代原生 `confirm()`):**
  - HTML 新增 `<dialog id=\"confirm-modal\" class=\"modal\">` 组件，含取消/确定按钮 + 遮罩点击关闭。
  - JS 新增 `confirmDialog(message)` → `Promise<boolean>` 工具函数，支持 ESC/点击遮罩自动 resolve(false)。
  - 全文 8 处 `confirm()` → `await confirmDialog()`，含 `deleteAmiibo` 的二次确认链路。
- [x] **5.4 按钮加载态 (Loading Spinner):**
  - JS 新增 `withLoading(btnOrId, asyncFn)` 工具函数，自动切换 DaisyUI `loading-spinner` + `disabled`。
  - 蓝牙连接/断开按钮 (`#btn-connect` / `#btn-disconnect`) 已挂载加载态。
- [x] **5.5 CSS 死代码清除:**
  - 移除 `footer a` 样式 (HTML footer 内无链接 — 死代码)。
  - 移除 2 条 Phase 4 遗留元注释 (\"Toast 样式已由...\" / \"footer 布局已由...\")。
  - 删除临时文件 `static/css/style.new.css` (需手动: `del static\\css\\style.new.css`)。
- [x] **5.6 可见性切换一致化:**
  - `#repo-toolbar`: HTML `class=\"hidden\"` + JS `style.display` 冲突 → 改为 `classList.add/remove('hidden')`。
  - HTML `repo-toolbar` 补充 `flex` 类确保 unhide 后正确布局。
  - `switchAmiiboTab()` 缩进修复 (0-indent → 4-space 标准缩进)。
