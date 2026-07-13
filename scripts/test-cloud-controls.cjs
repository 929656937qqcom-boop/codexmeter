const { app, BrowserWindow, clipboard, ipcMain } = require('electron')
const path = require('node:path')
const os = require('node:os')

const root = path.resolve(__dirname, '..')
const endpoint = 'https://codexmeter-cloud-929656937.netlify.app/api/usage'
const originalKey = `cm_sync_${'a'.repeat(43)}`
const generatedKey = `cm_sync_${'b'.repeat(43)}`
const calls = { generate: 0, pairCreate: 0, pairRedeem: 0, open: 0, save: 0, sync: 0 }

app.setPath('userData', path.join(os.tmpdir(), 'codexmeter-cloud-control-test'))

function registerHandlers() {
  const settings = {
    refreshIntervalMinutes: 5,
    hardwareDisplayEnabled: true,
    cloudSyncEnabled: false,
    cloudEndpoint: endpoint
  }
  const quota = { available: false, refreshedAt: new Date().toISOString(), windows: [], source: 'unavailable' }
  ipcMain.handle('settings:get', () => settings)
  ipcMain.handle('oauth:status', () => ({ connected: false }))
  ipcMain.handle('widget:state', () => ({ visible: false, alwaysOnTop: false }))
  ipcMain.handle('quota:refresh', () => quota)
  ipcMain.handle('quota:latest', () => quota)
  ipcMain.handle('usage:summary', () => null)
  ipcMain.handle('cloud:get', () => ({ enabled: false, endpoint, syncKey: originalKey, synced: false }))
  ipcMain.handle('cloud:generateKey', () => {
    calls.generate += 1
    return { syncKey: generatedKey }
  })
  ipcMain.handle('cloud:openDashboard', () => {
    calls.open += 1
    return { opened: true }
  })
  ipcMain.handle('cloud:createPairingCode', () => {
    calls.pairCreate += 1
    return { code: 'ABCD2345', expiresAt: new Date(Date.now() + 600_000).toISOString() }
  })
  ipcMain.handle('cloud:redeemPairingCode', () => {
    calls.pairRedeem += 1
    return { syncKey: `cm_device_${'c'.repeat(43)}` }
  })
  ipcMain.handle('cloud:save', (_event, enabled) => {
    calls.save += 1
    return { enabled, endpoint, syncKey: generatedKey, synced: false }
  })
  ipcMain.handle('cloud:syncNow', () => {
    calls.sync += 1
    return { synced: true, syncedAt: new Date().toISOString() }
  })
}

const wait = (milliseconds = 320) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function click(window, expression, label) {
  const target = await window.webContents.executeJavaScript(`(() => {
    const element = ${expression};
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    const hit = document.elementFromPoint(x, y);
    return {
      x, y,
      tag: element.tagName,
      text: element.textContent.trim(),
      appRegion: getComputedStyle(element).webkitAppRegion,
      pointerEvents: getComputedStyle(element).pointerEvents,
      hitTag: hit?.tagName,
      hitText: hit?.textContent?.trim(),
      hitRegion: hit ? getComputedStyle(hit).webkitAppRegion : null
    };
  })()`)
  if (!target) throw new Error(`找不到控件：${label}`)
  process.stdout.write(`CLICK ${label} ${JSON.stringify(target)}\n`)
  window.webContents.sendInputEvent({ type: 'mouseMove', x: target.x, y: target.y })
  window.webContents.sendInputEvent({ type: 'mouseDown', x: target.x, y: target.y, button: 'left', clickCount: 1 })
  window.webContents.sendInputEvent({ type: 'mouseUp', x: target.x, y: target.y, button: 'left', clickCount: 1 })
  await wait()
}

async function value(window, expression) {
  return window.webContents.executeJavaScript(`(() => ${expression})()`)
}

function check(condition, label) {
  if (!condition) throw new Error(`自测失败：${label}`)
  process.stdout.write(`PASS ${label}\n`)
}

app.whenReady().then(async () => {
  registerHandlers()
  const clipboardBefore = clipboard.readText()
  const window = new BrowserWindow({
    width: 1120,
    height: 920,
    show: true,
    webPreferences: {
      preload: path.join(root, 'dist-electron', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  try {
    await window.loadFile(path.join(root, 'dist', 'index.html'))
    await wait(900)
    const cloudButton = `[...document.querySelectorAll('.dashboard-control-strip button')].find((item) => item.textContent.includes('云端'))`

    await click(window, cloudButton, '云端入口')
    check(await value(window, `Boolean(document.querySelector('.cloud-sync-popover'))`), '云端入口可点击')

    await click(window, `document.querySelector('.cloud-sync-popover .hardware-connect-head button')`, '右上角关闭')
    check(!(await value(window, `Boolean(document.querySelector('.cloud-sync-popover'))`)), '右上角关闭可点击')

    await click(window, cloudButton, '重新打开云端入口')
    await click(window, `[...document.querySelectorAll('.cloud-key-actions button')].find((item) => item.textContent.includes('重新建立'))`, '重新建立云端空间')
    check(calls.generate === 1, '重新建立云端空间可点击')
    check(await value(window, `document.querySelector('.cloud-key-field input').value === '${generatedKey}'`), '生成结果写入输入框')

    await click(window, `document.querySelector('.cloud-key-field > button')`, '复制密钥')
    check(clipboard.readText() === generatedKey, '复制密钥可点击')

    await click(window, `[...document.querySelectorAll('.cloud-key-actions button')].find((item) => item.textContent.includes('网页看板'))`, '打开网页看板')
    check(calls.open === 1, '打开网页看板可点击')

    const savesBeforePair = calls.save
    await click(window, `document.querySelector('.cloud-pair-row button')`, '生成配对码')
    check(calls.pairCreate === 1 && calls.save === savesBeforePair + 1, '生成配对码可点击')
    check(await value(window, `document.querySelector('.cloud-pair-row input').value === 'ABCD2345'`), '配对码写入输入框')

    const savesBeforeRedeem = calls.save
    const syncsBeforeRedeem = calls.sync
    await click(window, `document.querySelectorAll('.cloud-pair-row button')[1]`, '加入同步空间')
    await wait(250)
    check(calls.pairRedeem === 1 && calls.save === savesBeforeRedeem + 1 && calls.sync === syncsBeforeRedeem + 1, '加入同步空间可点击且立即同步')
    check(!(await value(window, `Boolean(document.querySelector('.cloud-sync-popover'))`)), '加入成功后关闭弹窗')

    await click(window, cloudButton, '配对后重新打开云端入口')

    await click(window, `document.querySelector('.cloud-sync-popover .n-switch')`, '自动同步开关')
    check(await value(window, `document.querySelector('.cloud-sync-popover .n-switch').classList.contains('n-switch--active')`), '自动同步开关可点击')

    await click(window, `[...document.querySelectorAll('.cloud-sync-popover .hardware-connect-actions button')].find((item) => item.textContent.includes('取消'))`, '取消')
    check(!(await value(window, `Boolean(document.querySelector('.cloud-sync-popover'))`)), '取消可点击')

    await click(window, cloudButton, '再次打开云端入口')
    const savesBeforeManual = calls.save
    const syncsBeforeManual = calls.sync
    await click(window, `document.querySelector('.cloud-sync-popover .n-switch')`, '保存前开启自动同步')
    await click(window, `[...document.querySelectorAll('.cloud-sync-popover .hardware-connect-actions button')].find((item) => item.textContent.includes('保存'))`, '保存并同步')
    await wait(250)
    check(calls.save === savesBeforeManual + 1 && calls.sync === syncsBeforeManual + 1, '保存并同步可点击且调用同步')
    check(!(await value(window, `Boolean(document.querySelector('.cloud-sync-popover'))`)), '保存成功后关闭弹窗')
  } finally {
    clipboard.writeText(clipboardBefore)
    window.destroy()
    app.quit()
  }
}).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  app.exit(1)
})
