const state = { key: localStorage.getItem('codexmeter-sync-key') || '', data: null }
const elements = Object.fromEntries([
  'pairingView', 'dashboardView', 'pairingForm', 'syncKeyInput', 'generateKeyButton', 'pairingError',
  'connectionState', 'refreshButton', 'disconnectButton', 'deviceCount', 'todayTokens', 'todayDate',
  'weekTokens', 'officialTokens', 'coveragePercent', 'dedupState', 'lastSync', 'peakValue', 'chart', 'deviceList'
].map((id) => [id, document.getElementById(id)]))

elements.syncKeyInput.value = state.key
elements.pairingForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  state.key = elements.syncKeyInput.value.trim()
  await loadDashboard(true)
})
elements.generateKeyButton.addEventListener('click', () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  elements.syncKeyInput.value = `cm_sync_${token}`
  elements.syncKeyInput.type = 'text'
  elements.syncKeyInput.select()
})
elements.refreshButton.addEventListener('click', () => loadDashboard(false))
elements.disconnectButton.addEventListener('click', disconnect)

if (state.key) loadDashboard(false)

async function loadDashboard(persist) {
  setBusy(true)
  elements.pairingError.textContent = ''
  try {
    if (!/^cm_sync_[A-Za-z0-9_-]{32,}$/.test(state.key)) throw new Error('同步密钥格式不正确')
    const response = await fetch('/api/usage', { headers: { authorization: `Bearer ${state.key}` } })
    if (!response.ok) throw new Error(response.status === 401 ? '同步密钥无效' : '云端数据读取失败')
    state.data = await response.json()
    if (persist) localStorage.setItem('codexmeter-sync-key', state.key)
    renderDashboard(state.data)
    elements.pairingView.hidden = true
    elements.dashboardView.hidden = false
    elements.refreshButton.hidden = false
    elements.disconnectButton.hidden = false
    elements.connectionState.textContent = '已连接'
    elements.connectionState.classList.add('connected')
  } catch (error) {
    elements.pairingView.hidden = false
    elements.dashboardView.hidden = true
    elements.pairingError.textContent = error instanceof Error ? error.message : '连接失败'
  } finally {
    setBusy(false)
  }
}

function renderDashboard(data) {
  const devices = Array.isArray(data.devices) ? data.devices : []
  const daily = Array.isArray(data.dailyUsage) ? data.dailyUsage.slice(-14) : []
  const todayKey = shanghaiDateKey(new Date())
  const today = daily.find((day) => day.date === todayKey)
  const official = (Array.isArray(data.officialDailyUsage) ? data.officialDailyUsage : []).find((day) => day.date === todayKey)
  const weekStart = shanghaiDateKey(new Date(Date.now() - 6 * 86_400_000))
  elements.deviceCount.textContent = String(devices.length)
  elements.todayTokens.textContent = formatTokens(today?.totalTokens || 0)
  elements.todayDate.textContent = todayKey
  elements.weekTokens.textContent = formatTokens(daily.filter((day) => day.date >= weekStart).reduce((sum, day) => sum + number(day.totalTokens), 0))
  elements.officialTokens.textContent = official ? formatTokens(official.tokens) : '--'
  elements.coveragePercent.textContent = official?.tokens ? `${trim(number(today?.totalTokens) / official.tokens * 100)}%` : '--'
  elements.dedupState.textContent = `去重 ${number(data.deduplication?.duplicateEvents)} 条 · ${data.accountVerified ? '账号已校验' : '待账号校验'}`
  elements.lastSync.textContent = formatTime(data.updatedAt)
  const peak = Math.max(0, ...daily.map((day) => number(day.totalTokens)))
  elements.peakValue.textContent = `峰值 ${formatTokens(peak)}`
  renderChart(daily, devices, peak)
  renderDevices(devices)
}

function renderChart(days, devices, peak) {
  elements.chart.replaceChildren()
  const padded = [...Array(Math.max(0, 14 - days.length)).fill(null), ...days]
  for (const day of padded) {
    const item = document.createElement('div')
    item.className = 'chart-day'
    const bar = document.createElement('div')
    bar.className = 'chart-bar'
    const totalHeight = day && peak ? Math.max(3, number(day.totalTokens) / peak * 170) : 0
    bar.style.height = `${totalHeight}px`
    for (const device of devices) {
      const tokens = number(day?.devices?.[device.device.id])
      if (!tokens || !day.totalTokens) continue
      const segment = document.createElement('i')
      segment.className = 'chart-segment'
      segment.style.height = `${tokens / day.totalTokens * totalHeight}px`
      segment.title = `${device.device.name}: ${formatTokens(tokens)}`
      bar.append(segment)
    }
    const label = document.createElement('span')
    label.textContent = day?.date?.slice(5).replace('-', '/') || ''
    item.append(bar, label)
    elements.chart.append(item)
  }
}

function renderDevices(devices) {
  elements.deviceList.replaceChildren()
  for (const item of devices) {
    const card = document.createElement('article')
    card.className = 'device-card'
    const head = document.createElement('div')
    head.className = 'device-head'
    const name = document.createElement('strong')
    name.textContent = item.device.name
    const actions = document.createElement('div')
    actions.className = 'device-actions'
    const status = document.createElement('span')
    status.textContent = Date.now() - Date.parse(item.receivedAt) < 30 * 60_000 ? '在线' : '已同步'
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = '移除'
    remove.addEventListener('click', () => removeDevice(item.device.id, item.device.name))
    actions.append(status, remove)
    head.append(name, actions)
    const meta = document.createElement('div')
    meta.className = 'device-meta'
    meta.textContent = `${platformLabel(item.device.platform)} ${item.device.arch || ''} · v${item.device.appVersion || '--'} · ${formatTime(item.receivedAt)}`
    const metrics = document.createElement('div')
    metrics.className = 'device-metrics'
    metrics.append(metric('今日贡献', item.contribution?.todayTokens), metric('7 日贡献', item.contribution?.sevenDaysTokens))
    const quality = document.createElement('div')
    quality.className = 'device-quality'
    quality.textContent = `空间贡献 ${trim(number(item.contribution?.sharePercent))}% · 本地完整度 ${number(item.dataQuality.score)}%`
    card.append(head, meta, metrics, quality)
    elements.deviceList.append(card)
  }
}

async function removeDevice(deviceId, name) {
  if (!confirm(`从同步空间移除“${name}”？该设备下次同步时仍可重新加入。`)) return
  const response = await fetch(`/api/usage?deviceId=${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${state.key}` }
  })
  if (!response.ok) {
    alert('移除设备失败')
    return
  }
  await loadDashboard(false)
}

function metric(label, value) {
  const wrapper = document.createElement('div')
  const span = document.createElement('span')
  span.textContent = label
  const strong = document.createElement('strong')
  strong.textContent = formatTokens(number(value))
  wrapper.append(span, strong)
  return wrapper
}

function disconnect() {
  localStorage.removeItem('codexmeter-sync-key')
  state.key = ''
  state.data = null
  elements.syncKeyInput.value = ''
  elements.dashboardView.hidden = true
  elements.pairingView.hidden = false
  elements.refreshButton.hidden = true
  elements.disconnectButton.hidden = true
  elements.connectionState.textContent = '未连接'
  elements.connectionState.classList.remove('connected')
}

function setBusy(busy) {
  elements.refreshButton.disabled = busy
  elements.pairingForm.querySelector('button.primary').disabled = busy
}

function number(value) { return Number.isFinite(Number(value)) ? Number(value) : 0 }
function formatTokens(value) {
  if (value >= 100_000_000) return `${trim(value / 100_000_000)}亿`
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}百万`
  if (value >= 10_000) return `${trim(value / 10_000)}万`
  return Math.round(value).toLocaleString('zh-CN')
}
function trim(value) { return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2).replace(/\.0+$|(?<=\.[0-9])0+$/, '') }
function formatTime(value) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '--'
}
function platformLabel(value) {
  if (value === 'darwin') return 'macOS'
  if (value === 'win32') return 'Windows'
  if (value === 'linux') return 'Linux'
  return value || '未知系统'
}
function shanghaiDateKey(date) {
  return new Date(date.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 10)
}
