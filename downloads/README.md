# 下载与本地打包

当前仓库暂未发布 GitHub Release。需要可执行文件时，请在本地构建：

```powershell
pnpm install
pnpm dist:portable
```

构建完成后，Windows 便携版会输出到 `release/` 目录。

## 注意

- `release/` 是构建产物目录，不会提交到 Git。
- 当前版本未做代码签名；Windows 可能提示未知发布者。
- 硬件固件和刷机页面在 `docs/flash/` 与 `esp32/` 下维护。
