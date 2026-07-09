# CodexMeter

CodexMeter 是一个本地运行的 Codex 用量监控桌面工具。它基于 Electron + Vue 3 构建，重点用于查看 Codex 额度、桌面悬浮球、小组件状态，以及本机 Codex session 日志中的 token 消耗趋势。

> 当前仓库是基于 `MrWanCC/CodexMeter` 的本地改造版本，保留原项目的非商业许可边界。

## 当前能力

- Codex OAuth 授权状态与额度读取
- 5 小时额度、7 天额度、重置时间与重置卡展示
- 轻量悬浮球小组件，支持悬停详情与双击打开主界面
- 本机 token 分析页：
  - 今日 / 7 日 / 本月 token
  - input / cached input / output 拆分
  - workspace / thread 项目排行
  - 工具与 Skill Top
  - 今日任务看板
  - API 等效价值粗估
- ESP32-C3 小屏硬件显示方案，支持 BLE / HTTP 推送
- 本地安全存储授权信息，不主动发起模型请求

## 本地开发

环境要求：

- Node.js 20+
- pnpm
- Windows 10/11

```powershell
pnpm install
pnpm dev
```

常用命令：

```powershell
pnpm test
pnpm build
pnpm dist:portable
```

构建产物默认输出到 `dist/`、`dist-electron/` 和 `release/`，这些目录不会提交到 Git。

## 项目结构

```text
src/
  main/       Electron 主进程、OAuth、额度读取、usage provider
  preload/    安全暴露给渲染进程的 IPC 接口
  renderer/   Vue 页面、小组件与样式
  shared/     主进程与渲染进程共享类型和解析逻辑
tests/        单元测试和 UI 尺寸回归测试
docs/         使用说明、硬件说明和展示图片
esp32/        ESP32-C3 固件草图
scripts/      构建辅助脚本
```

## 隐私与边界

- 本工具只读取本机授权后的 Codex 用量数据和本机 `.codex` session 日志。
- token 分析是本机粗估，不代表 OpenAI/Codex 账号级完整审计。
- `.env`、本地缓存、构建产物、release 包、硬件 secrets 不会提交到仓库。
- API 等效价值仅用于理解相对消耗，不等同真实账单。

## 验证状态

当前提交前已执行：

```powershell
pnpm test
pnpm build
```

## License

本项目保留原项目的自定义非商业许可，完整条款见 [LICENSE](LICENSE)。
