# RasCon_NS Python 3.11.2 适配与优化计划

## 项目概述
将 RasCon_NS 项目从旧版 Python（3.7）适配到 Python 3.11.2，并优化 WebUI 以更好地支持 Pro Controller 和 Amiibo 刷写功能。

---

## 一、Python 3.11.2 兼容性修复

### 1.1 asyncio 相关修复 (高优先级)

- [x] **command.py L105** - `asyncio.get_event_loop()` 已废弃
  - 问题：Python 3.10+ 中在没有运行中的事件循环时会发出警告
  - 修复：移除该调用，使用 NFCTag.load_amiibo() 替代

- [x] **run.py L55** - `loop.run_until_complete()` 用法
  - 问题：推荐使用 `asyncio.run()` 替代
  - 修复：改用 `asyncio.run(_main(args))`

- [x] **joycontrol/utils.py L11** - 类默认参数中的 `asyncio.get_event_loop()`
  - 问题：在模块加载时调用会失败
  - 修复：将 `loop` 参数默认值改为 `None`，在方法内使用 `asyncio.get_running_loop()`

- [x] **joycontrol/server.py L119, L171** - `asyncio.get_event_loop()` 调用
  - 修复：使用 `asyncio.get_running_loop()`

- [x] **joycontrol/my_semaphore.py** - `self._loop` 不再存在
  - 问题：Python 3.10+ 移除了 `asyncio.Semaphore` 的 `_loop` 属性
  - 修复：重构 `MySemaphore` 类，不再继承 `asyncio.Semaphore`，使用 `asyncio.get_running_loop()`

### 1.2 语法警告修复 (中优先级)

- [x] **command.py L183** - `if release_sec is 0.0:`
  - 问题：`is` 用于比较字面量值在 Python 3.8+ 产生 SyntaxWarning
  - 修复：改为 `if release_sec == 0.0:`

- [x] **joycontrol/my_semaphore.py L71** - `not value is None`
  - 修复：改为 `value is not None`

### 1.3 平台兼容性

- [x] **command.py L16-18** - `signal.SIGALRM` 在 Windows 不存在
  - 问题：Windows 上没有 SIGALRM 信号
  - 修复：添加平台检测 (`sys.platform != 'win32'`)，Windows 上使用 `asyncio.wait_for` 替代

---

## 二、Amiibo 功能修复 (高优先级)

### 2.1 应用 patch.txt 中的修复

- [x] **command.py L102-113** - Amiibo 设置使用 NFCTag 类
  - 问题：原代码直接读取文件内容设置 NFC，不正确
  - 修复：使用 `NFCTag.load_amiibo()` 方法加载 amiibo
  ```python
  # 修改后
  from joycontrol.nfc_tag import NFCTag
  path = 'file/amiibo/' + fileName
  tag = NFCTag.load_amiibo(path)
  self.controller_state.set_nfc(tag)
  ```

- [x] **command.py** - 添加 NFCTag 导入
  - 在文件头部添加 `from joycontrol.nfc_tag import NFCTag`

---

## 三、WebUI 优化 (中优先级)

### 3.1 HTML 错误修复

- [x] **templates/index.html** - 修复 HTML 错误
  - L56: `</buttonm>` 应为 `</button>` - 已修复
  - L82: `</buttonm>` 应为 `</button>` - 已修复
  - L87-94: 缺少 `<tr>` 标签 - 已修复

### 3.2 UI 现代化改进

- [x] 创建全新的现代化 WebUI 界面
  - 响应式设计
  - 深色主题
  - 清晰的 Pro Controller 布局
  - 改进的 Amiibo 上传区域
  - 脚本编辑器带语法提示

### 3.3 备份

- 原始界面备份为 `templates/index_old.html`

---

## 四、代码清理与优化

### 4.1 错误处理改进

- [x] Amiibo 加载添加 try-except 错误处理

### 4.2 代码风格

- [x] 添加 `sys` 导入用于平台检测
- [x] 改进函数注释

---

## 五、依赖要求

### requirements.txt

```
flask>=2.0.0
aioconsole>=0.6.0
crc8
dbus-python  # Linux only
hid
```

---

## 六、修复执行状态

1. **第一阶段：Python 3.11 兼容性** ✅ 已完成
   - 1.1 所有 asyncio 相关修复
   - 1.2 语法警告修复

2. **第二阶段：核心功能修复** ✅ 已完成
   - 2.1 Amiibo 功能修复

3. **第三阶段：WebUI 改进** ✅ 已完成
   - 3.1 HTML 错误修复
   - 3.2 UI 现代化

4. **第四阶段：代码质量** ✅ 基本完成
   - 4.1 错误处理改进

---

## 七、测试计划

- [ ] Python 3.11.2 下启动 web.py 无报错
- [ ] Python 3.11.2 下启动 run.py 无报错
- [ ] 蓝牙连接 Switch 成功
- [ ] WebUI 按键控制正常
- [ ] 摇杆控制正常
- [ ] 单个 Amiibo 上传和使用正常
- [ ] 批量 Amiibo 脚本执行正常

---

## 八、已知限制

1. 本项目主要设计用于 Linux/树莓派环境
2. Windows 上蓝牙功能无法使用（需要 Linux 蓝牙栈）
3. 需要 root 权限运行

---

## 修改的文件列表

| 文件 | 修改内容 |
|------|---------|
| `run.py` | asyncio.run() 替代 loop.run_until_complete() |
| `command.py` | 添加 NFCTag 导入、修复 Amiibo 加载、平台兼容性、语法修复 |
| `joycontrol/utils.py` | AsyncHID 类 loop 参数修复 |
| `joycontrol/server.py` | get_running_loop() 替代 get_event_loop() |
| `joycontrol/my_semaphore.py` | 完全重构以兼容 Python 3.10+ |
| `templates/index.html` | 全新现代化界面 |
| `templates/index_old.html` | 原界面备份 |

---

## 修改记录

| 日期 | 修改内容 | 状态 |
|------|---------|------|
| 2026-03-04 | 创建 TODO.md | ✅ |
| 2026-03-04 | 完成 Python 3.11 兼容性修复 | ✅ |
| 2026-03-04 | 完成 Amiibo 功能修复 | ✅ |
| 2026-03-04 | 完成 WebUI 优化 | ✅ |
| 2026-03-04 | 更新 TODO.md 状态 | ✅ |

