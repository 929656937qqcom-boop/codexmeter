const state = {
  key: localStorage.getItem('codexmeter-sync-key') || '',
  data: null,
  activePeriod: 'today',
  selectedDate: '',
  emptyRetries: 0,
  emptyRetryTimer: 0,
  connectionRetryCount: 0,
  connectionRetryTimer: 0,
  dashboardRefreshTimer: 0,
  diagnostics: { last24Hours: 0, last7Days: 0, byKind: {}, recent: [] }
}

const ids = [
  'pairingView', 'loadingView', 'loadingTitle', 'loadingDetail', 'retryButton', 'dashboardView', 'pairingForm', 'syncKeyInput', 'pairingError', 'connectionState', 'refreshButton',
  'disconnectButton', 'emptyNotice', 'todayTokens', 'todayValue', 'todayEvents', 'weekTokens', 'weekValue', 'weekEvents',
  'fiveHourState', 'fiveHourDial', 'fiveHourRemaining', 'fiveHourUsed', 'fiveHourReset', 'weekQuotaState', 'weekQuotaDial',
  'weekRemaining', 'weekUsed', 'weekReset', 'resetCardTitle', 'resetCardList',
  'monthTokens', 'monthValue', 'monthEvents', 'inputTokens', 'cachedTokens', 'outputTokens', 'inputBar', 'cachedBar',
  'outputBar', 'selectedDaySummary', 'deviceCount', 'officialTokens', 'coveragePercent', 'peakValue', 'trendSvg', 'trendGrid',
  'trendAreaPath', 'trendLinePath', 'trendPoints', 'trendDays', 'projectDayLabel', 'projectDayTotal', 'projectDayEvents',
  'dayProjectList', 'projectRankList', 'toolRankList', 'syncMeta', 'dedupState', 'deviceList',
  'healthState', 'healthSummary', 'diagnosticList'
]
const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]))

elements.syncKeyInput.value = state.key
elements.pairingForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  state.key = elements.syncKeyInput.value.trim()
  await loadDashboard(true)
})
elements.refreshButton.addEventListener('click', () => loadDashboard(false))
elements.disconnectButton.addEventListener('click', disconnect)
elements.retryButton.addEventListener('click', () => loadDashboard(false))
document.querySelectorAll('.period-card').forEach((button) => button.addEventListener('click', () => {
  state.activePeriod = button.dataset.period
  document.querySelectorAll('.period-card').forEach((item) => item.classList.toggle('active', item === button))
  renderSplit()
}))

const pairCode = new URL(location.href).searchParams.get('pair')
if (pairCode) redeemWebPair(pairCode)
else if (state.key) {
  showLoadingView('正在恢复云端看板', '正在读取已保存的安全凭证')
  setConnectionState('connecting', '正在连接')
  loadDashboard(false)
} else {
  showPairingView()
}

async function redeemWebPair(code) {
  setBusy(true)
  showLoadingView('正在安全登录', '正在验证一次性配对码')
  setConnectionState('connecting', '正在安全登录')
  try {
    const response = await fetch(`/api/pair?code=${encodeURIComponent(code)}`)
    const data = await response.json()
    if (!response.ok || !data.token) throw new Error(data.error || '一次性登录码无效')
    state.key = data.token
    localStorage.setItem('codexmeter-sync-key', state.key)
    history.replaceState(null, '', location.pathname)
    await loadDashboard(false)
  } catch (error) {
    showPairingView(error instanceof Error ? error.message : '自动登录失败')
    setConnectionState('warning', '连接失败')
  } finally {
    setBusy(false)
  }
}

async function loadDashboard(persist, silent = false) {
  if (!silent) setBusy(true)
  elements.pairingError.textContent = ''
  if (!state.data) showLoadingView('正在恢复云端看板', '正在安全读取账号汇总数据')
  if (!silent) setConnectionState('connecting', state.data ? '正在刷新' : '正在连接')
  try {
    if (!/^cm_(?:sync|device)_[A-Za-z0-9_-]{32,}$/.test(state.key)) throw requestError('同步凭证格式不正确', 'auth')
    const headers = { authorization: `Bearer ${state.key}` }
    const [response, diagnosticResponse] = await Promise.all([
      fetchWithTimeout('/api/usage', { headers }, 12_000),
      fetchWithTimeout('/api/diagnostics', { headers }, 5_000).catch(() => null)
    ])
    if (!response.ok) throw requestError(response.status === 401 ? '同步凭证已失效，请重新连接' : '云端数据读取失败', response.status === 401 ? 'auth' : 'network')
    state.data = await response.json()
    state.diagnostics = diagnosticResponse?.ok
      ? await diagnosticResponse.json()
      : { last24Hours: 0, last7Days: 0, byKind: {}, recent: [] }
    if (persist) localStorage.setItem('codexmeter-sync-key', state.key)
    clearTimeout(state.connectionRetryTimer)
    state.connectionRetryCount = 0
    renderDashboard()
    elements.pairingView.hidden = true
    elements.loadingView.hidden = true
    elements.dashboardView.hidden = false
    elements.refreshButton.hidden = false
    elements.disconnectButton.hidden = false
    setConnectionState('connected', state.data.deviceCount ? '已同步 · 60 秒刷新' : '已连接 · 待同步')
    scheduleDashboardRefresh()
  } catch (error) {
    if (error?.kind === 'auth') {
      localStorage.removeItem('codexmeter-sync-key')
      showPairingView(error.message)
      setConnectionState('warning', '需要重新连接')
      return
    }
    if (state.data) {
      elements.dashboardView.hidden = false
      elements.loadingView.hidden = true
      setConnectionState('warning', '刷新失败 · 保留上次数据')
      return
    }
    scheduleConnectionRetry(error instanceof Error ? error.message : '连接暂时中断')
  } finally {
    if (!silent) setBusy(false)
  }
}

function requestError(message, kind) {
  const error = new Error(message)
  error.kind = kind
  return error
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (error?.name === 'AbortError') throw requestError('云端响应超时', 'network')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function setConnectionState(kind, text) {
  elements.connectionState.classList.remove('connected', 'connecting', 'warning', 'disconnected')
  elements.connectionState.classList.add(kind)
  elements.connectionState.textContent = text
}

function showLoadingView(title, detail, paused = false) {
  elements.pairingView.hidden = true
  elements.dashboardView.hidden = true
  elements.loadingView.hidden = false
  elements.loadingView.classList.toggle('is-paused', paused)
  elements.loadingTitle.textContent = title
  elements.loadingDetail.textContent = detail
  elements.retryButton.hidden = !paused
}

function showPairingView(message = '') {
  clearTimeout(state.connectionRetryTimer)
  elements.loadingView.hidden = true
  elements.dashboardView.hidden = true
  elements.pairingView.hidden = false
  elements.refreshButton.hidden = true
  elements.disconnectButton.hidden = true
  elements.pairingError.textContent = message
  setConnectionState('disconnected', state.key ? '等待连接' : '未连接')
}

function scheduleConnectionRetry(message) {
  clearTimeout(state.connectionRetryTimer)
  state.connectionRetryCount += 1
  const delay = Math.min(15_000, 1500 * (2 ** Math.min(3, state.connectionRetryCount - 1)))
  showLoadingView('正在恢复连接', `${message} · ${Math.ceil(delay / 1000)} 秒后自动重试`, true)
  setConnectionState('warning', '连接中断 · 正在重试')
  state.connectionRetryTimer = setTimeout(() => loadDashboard(false, true), delay)
}

function renderDashboard() {
  const data = state.data || {}
  renderQuota(data.quota)
  const periods = data.periods || {}
  renderPeriod('today', periods.today, elements.todayTokens, elements.todayValue, elements.todayEvents)
  renderPeriod('sevenDays', periods.sevenDays, elements.weekTokens, elements.weekValue, elements.weekEvents)
  renderPeriod('month', periods.month, elements.monthTokens, elements.monthValue, elements.monthEvents)
  renderSplit()

  const devices = Array.isArray(data.devices) ? data.devices : []
  const daily = lastSevenDays(Array.isArray(data.dailyUsage) ? data.dailyUsage : [])
  state.selectedDate = daily.some((day) => day.date === state.selectedDate) ? state.selectedDate : daily.at(-1)?.date || ''
  elements.emptyNotice.hidden = devices.length > 0
  scheduleEmptyRetry(devices.length)
  elements.deviceCount.textContent = `${devices.length} 台设备`
  renderTrend(daily)
  renderSelectedDay(daily)
  renderSelectedAccountMetrics(daily)
  renderRanks(data)
  renderDevices(devices)
  renderDiagnostics()

  elements.dedupState.textContent = `去重 ${number(data.deduplication?.duplicateEvents)} 条 · ${data.accountVerified ? '账号已校验' : '待账号校验'}`
  elements.syncMeta.textContent = data.updatedAt ? `数据截至 ${formatTime(data.updatedAt)} · 网页每 60 秒刷新` : '尚未收到设备数据'
}

function scheduleDashboardRefresh() {
  clearInterval(state.dashboardRefreshTimer)
  state.dashboardRefreshTimer = setInterval(() => loadDashboard(false, true), 60_000)
}

function scheduleEmptyRetry(deviceCount) {
  clearTimeout(state.emptyRetryTimer)
  if (deviceCount > 0) {
    state.emptyRetries = 0
    return
  }
  if (state.emptyRetries >= 5) return
  state.emptyRetryTimer = setTimeout(() => {
    state.emptyRetries += 1
    loadDashboard(false, true)
  }, 3000)
}

function renderDiagnostics() {
  const diagnostics = state.diagnostics || {}
  const recent = Array.isArray(diagnostics.recent) ? diagnostics.recent : []
  const last24Hours = number(diagnostics.last24Hours)
  elements.healthState.textContent = last24Hours ? '需关注' : '运行正常'
  elements.healthState.classList.toggle('warning', last24Hours > 0)
  elements.healthSummary.textContent = `近 24 小时 ${last24Hours} 条 · 近 7 天 ${number(diagnostics.last7Days)} 条`
  elements.diagnosticList.replaceChildren(...(recent.length ? recent.slice(0, 6).map((event) => {
    const row = document.createElement('div')
    row.className = 'diagnostic-row'
    const copy = document.createElement('div')
    const title = document.createElement('strong')
    const detail = document.createElement('span')
    const time = document.createElement('time')
    title.textContent = diagnosticKindLabel(event.kind)
    detail.textContent = `${event.device?.name || '未知设备'} · ${event.message || '未提供错误摘要'}`
    time.textContent = formatTime(event.createdAt)
    copy.append(title, detail)
    row.append(copy, time)
    return row
  }) : [rankRow('近 7 天未收到诊断错误', '正常')]))
}

function diagnosticKindLabel(kind) {
  return ({
    'main-error': '主进程异常',
    'renderer-error': '界面异常',
    'renderer-crash': '界面进程退出',
    'cloud-sync-error': '云同步失败',
    'update-error': '自动更新失败'
  })[kind] || '运行异常'
}

function renderQuota(quota) {
  const fiveHour = quota?.windows?.find((window) => window.code === '5h')
  const week = quota?.windows?.find((window) => window.code === '7d')
  renderQuotaWindow(fiveHour, elements.fiveHourDial, elements.fiveHourRemaining, elements.fiveHourUsed, elements.fiveHourReset, elements.fiveHourState, '#20c66f')
  renderQuotaWindow(week, elements.weekQuotaDial, elements.weekRemaining, elements.weekUsed, elements.weekReset, elements.weekQuotaState, '#f0c51a')
  const cards = Array.isArray(quota?.resetCards) ? quota.resetCards : []
  elements.resetCardTitle.textContent = `重置卡 · ${cards.length} 张`
  elements.resetCardList.replaceChildren(...(cards.length ? cards.slice(0, 3).map((card, index) => {
    const row = document.createElement('div')
    const expiry = new Date(card.expiresAt)
    const remaining = Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / 86_400_000))
    row.innerHTML = `<span>第 ${index + 1} 张</span><strong>剩余 ${remaining} 天 · ${shortDate(card.expiresAt)}</strong>`
    return row
  }) : [rankRow('暂无可用重置卡', '--')]))
}

function renderQuotaWindow(window, dial, remaining, used, reset, stateElement, color) {
  const available = Boolean(window)
  const percentUsed = available ? Math.max(0, Math.min(100, number(window.percentUsed))) : 0
  const percentRemaining = Math.round(100 - percentUsed)
  dial.style.background = `conic-gradient(${color} 0 ${percentRemaining}%, #334155 ${percentRemaining}% 100%)`
  remaining.textContent = available ? `${percentRemaining}%` : '--'
  used.textContent = available ? `${trim(percentUsed)}%` : '--'
  reset.textContent = available ? compactReset(window.resetAt) : '--'
  stateElement.textContent = !available ? '暂无数据' : percentRemaining >= 50 ? '充足' : percentRemaining >= 20 ? '关注' : '紧张'
}

function renderPeriod(key, period, totalElement, valueElement, eventsElement) {
  const safe = period || {}
  totalElement.textContent = formatTokens(safe.total?.totalTokens || 0)
  valueElement.textContent = formatUsd(safe.apiEstimateUsd || 0)
  eventsElement.textContent = `${number(safe.events)} 次`
}

function renderSplit() {
  const total = state.data?.periods?.[state.activePeriod]?.total || {}
  const values = [number(total.inputTokens), number(total.cachedInputTokens), number(total.outputTokens)]
  const max = Math.max(1, ...values)
  elements.inputTokens.textContent = formatTokens(values[0])
  elements.cachedTokens.textContent = formatTokens(values[1])
  elements.outputTokens.textContent = formatTokens(values[2])
  ;[elements.inputBar, elements.cachedBar, elements.outputBar].forEach((bar, index) => {
    bar.style.width = `${values[index] ? Math.max(2, values[index] / max * 100) : 0}%`
  })
}

function renderTrend(days) {
  const peak = Math.max(0, ...days.map(dayTokens))
  elements.peakValue.textContent = `峰值 ${formatTokens(peak)}`
  elements.trendGrid.replaceChildren(...[18, 44, 70].map((y) => svg('line', { x1: 4, y1: y, x2: 96, y2: y, class: 'trend-grid-line' })))
  const points = days.map((day, index) => ({
    x: days.length === 1 ? 50 : 5 + index * (90 / Math.max(1, days.length - 1)),
    y: 67 - (dayTokens(day) / Math.max(1, peak)) * 49,
    day
  }))
  const line = smoothPath(points)
  elements.trendLinePath.setAttribute('d', line)
  elements.trendAreaPath.setAttribute('d', points.length ? `${line} L ${points.at(-1).x} 70 L ${points[0].x} 70 Z` : '')
  elements.trendPoints.replaceChildren(...points.map((point) => {
    const group = svg('g', { class: `trend-point${point.day.date === state.selectedDate ? ' selected' : ''}` })
    const title = svg('title', {})
    title.textContent = accountMetricTitle(accountMetricsForDate(point.day.date, days))
    group.append(title)
    if (point.day.date === state.selectedDate) group.append(svg('line', { x1: point.x, y1: 12, x2: point.x, y2: 70, class: 'trend-guide' }))
    group.append(svg('circle', { cx: point.x, cy: point.y, r: 6, class: 'trend-hit' }))
    group.append(svg('circle', { cx: point.x, cy: point.y, r: 2.2, class: 'trend-dot' }))
    group.addEventListener('mouseenter', () => selectDay(point.day.date, days))
    return group
  }))
  elements.trendDays.replaceChildren(...days.map((day) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = day.date === state.selectedDate ? 'active' : ''
    button.innerHTML = `<span>${weekday(day.date)}</span><strong>${formatTokens(dayTokens(day))}</strong><small>${day.date.slice(5).replace('-', '/')}</small>`
    button.title = accountMetricTitle(accountMetricsForDate(day.date, days))
    button.addEventListener('mouseenter', () => selectDay(day.date, days))
    button.addEventListener('focus', () => selectDay(day.date, days))
    button.addEventListener('click', () => selectDay(day.date, days))
    return button
  }))
}

function selectDay(date, days) {
  if (state.selectedDate === date) return
  state.selectedDate = date
  renderTrend(days)
  renderSelectedDay(days)
  renderSelectedAccountMetrics(days)
}

function renderSelectedDay(days) {
  const day = days.find((item) => item.date === state.selectedDate)
  const projects = Array.isArray(day?.projects) ? day.projects : []
  const metrics = accountMetricsForDate(state.selectedDate, days)
  elements.selectedDaySummary.textContent = day
    ? `${day.date.slice(5).replace('-', '/')} · 本地 ${formatTokens(metrics.localTokens)} · 官方 ${metrics.officialTokens === null ? '--' : formatTokens(metrics.officialTokens)} · 覆盖率 ${formatCoverage(metrics.coveragePercent)}`
    : '每日 Token 与项目构成'
  elements.projectDayLabel.textContent = day ? `${day.date.slice(5).replace('-', '/')} 项目` : '项目构成'
  elements.projectDayTotal.textContent = formatTokens(dayTokens(day))
  elements.projectDayEvents.textContent = `${number(day?.events)} 次`
  elements.dayProjectList.replaceChildren(...(projects.length ? projects.slice(0, 5).map((project, index) => projectRow(project.name, project.totalTokens, dayTokens(day), index)) : [emptyRow('当天暂无项目数据')]))
}

function renderSelectedAccountMetrics(days) {
  const metrics = accountMetricsForDate(state.selectedDate, days)
  const title = accountMetricTitle(metrics)
  elements.officialTokens.textContent = `官方 ${metrics.officialTokens === null ? '--' : formatTokens(metrics.officialTokens)}`
  elements.coveragePercent.textContent = `覆盖率 ${formatCoverage(metrics.coveragePercent)}`
  elements.officialTokens.title = title
  elements.coveragePercent.title = title
  elements.officialTokens.classList.toggle('unavailable', metrics.officialTokens === null)
  elements.coveragePercent.classList.toggle('unavailable', metrics.coveragePercent === null)
}

function accountMetricsForDate(date, days) {
  const local = days.find((day) => day.date === date)
  const official = (Array.isArray(state.data?.officialDailyUsage) ? state.data.officialDailyUsage : []).find((day) => day.date === date)
  const localTokens = dayTokens(local)
  const officialTokens = official ? number(official.tokens) : null
  const coveragePercent = officialTokens && officialTokens > 0 ? localTokens / officialTokens * 100 : null
  return { date, localTokens, officialTokens, coveragePercent }
}

function accountMetricTitle(metrics) {
  const date = metrics.date ? metrics.date.slice(5).replace('-', '/') : '--'
  if (metrics.officialTokens === null) return `${date} · 本地 ${formatTokens(metrics.localTokens)} · 官方数据尚未同步`
  return `${date} · 本地 ${formatTokens(metrics.localTokens)} · 官方 ${formatTokens(metrics.officialTokens)} · 覆盖率 ${formatCoverage(metrics.coveragePercent)}`
}

function formatCoverage(value) {
  return value === null ? '--' : `${trim(value)}%`
}

function renderRanks(data) {
  const projects = Array.isArray(data.projects) ? data.projects : []
  const tools = Array.isArray(data.tools) ? data.tools : []
  const skills = Array.isArray(data.skills) ? data.skills : []
  elements.projectRankList.replaceChildren(...(projects.length ? projects.slice(0, 5).map((project) => rankRow(project.name, `${formatTokens(project.totalTokens)} · ${shortDate(project.lastActive)}`)) : [emptyRow('等待新版设备同步')]))
  const operationRows = [
    ...tools.slice(0, 4).map((tool) => rankRow(tool.name, `${number(tool.calls)} 次 · ${formatChars(tool.outputChars)}`)),
    ...skills.slice(0, 2).map((skill) => rankRow(skill.name, `${number(skill.hits)} 次`))
  ]
  elements.toolRankList.replaceChildren(...(operationRows.length ? operationRows : [emptyRow('等待新版设备同步')]))
}

function renderDevices(devices) {
  elements.deviceList.replaceChildren(...(devices.length ? devices.map((item) => {
    const card = document.createElement('article')
    card.className = 'device-card'
    const online = Date.now() - Date.parse(item.receivedAt) < 30 * 60_000
    card.innerHTML = `<div class="device-head"><strong></strong><div class="device-actions"><span>${online ? '在线' : '已同步'}</span><button class="rename-device" type="button">改名</button><button class="remove-device" type="button">移除</button></div></div><form class="device-name-editor" hidden><input type="text" maxlength="32" aria-label="设备名称"><button class="save-device-name" type="submit">保存</button><button class="cancel-device-name" type="button">取消</button></form><div class="device-meta"></div><div class="device-metrics"><div><span>今日贡献</span><strong>${formatTokens(item.contribution?.todayTokens || 0)}</strong></div><div><span>7 日贡献</span><strong>${formatTokens(item.contribution?.sevenDaysTokens || 0)}</strong></div></div><div class="device-quality">空间贡献 ${trim(number(item.contribution?.sharePercent))}% · 本地完整度 ${number(item.dataQuality?.score)}%</div>`
    card.querySelector('.device-head > strong').textContent = item.device?.name || '未命名设备'
    card.querySelector('.device-meta').textContent = `${platformLabel(item.device?.platform)} ${item.device?.arch || ''} · v${item.device?.appVersion || '--'} · ${formatTime(item.receivedAt)}`
    const editor = card.querySelector('.device-name-editor')
    const input = editor.querySelector('input')
    card.querySelector('.rename-device').addEventListener('click', () => {
      input.value = item.device?.name || ''
      editor.hidden = false
      input.focus()
      input.select()
    })
    card.querySelector('.cancel-device-name').addEventListener('click', () => { editor.hidden = true })
    editor.addEventListener('submit', (event) => {
      event.preventDefault()
      renameDevice(item.device.id, input.value, editor)
    })
    card.querySelector('.remove-device').addEventListener('click', () => removeDevice(item.device.id, item.device.name))
    return card
  }) : [emptyRow('尚未同步任何设备')]))
}

async function renameDevice(deviceId, name, editor) {
  const normalized = String(name || '').trim()
  if (!normalized || Array.from(normalized).length > 32) return alert('设备名称需为 1-32 个字符')
  const controls = editor.querySelectorAll('input, button')
  controls.forEach((control) => { control.disabled = true })
  try {
    const response = await fetch('/api/usage', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${state.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId, name: normalized })
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || '设备改名失败')
    editor.hidden = true
    await loadDashboard(false, true)
  } catch (error) {
    alert(error instanceof Error ? error.message : '设备改名失败')
  } finally {
    controls.forEach((control) => { control.disabled = false })
  }
}

async function removeDevice(deviceId, name) {
  if (!confirm(`从同步空间移除“${name}”？该设备下次同步时仍可重新加入。`)) return
  const response = await fetch(`/api/usage?deviceId=${encodeURIComponent(deviceId)}`, { method: 'DELETE', headers: { authorization: `Bearer ${state.key}` } })
  if (!response.ok) return alert('移除设备失败')
  await loadDashboard(false)
}

function disconnect() {
  clearTimeout(state.emptyRetryTimer)
  clearTimeout(state.connectionRetryTimer)
  clearInterval(state.dashboardRefreshTimer)
  localStorage.removeItem('codexmeter-sync-key')
  state.key = ''
  state.data = null
  elements.syncKeyInput.value = ''
  state.connectionRetryCount = 0
  showPairingView()
}

function setBusy(busy) {
  elements.refreshButton.disabled = busy
  elements.pairingForm.querySelector('button.primary').disabled = busy
}

function projectRow(name, value, total, index) {
  const row = document.createElement('div')
  row.className = `project-row tone-${index % 5}`
  const share = total ? number(value) / total * 100 : 0
  row.innerHTML = `<div><span></span><strong>${formatTokens(value)} · ${trim(share)}%</strong></div><i><b style="width:${Math.max(share ? 2 : 0, share)}%"></b></i>`
  row.querySelector('span').textContent = name || '未命名项目'
  return row
}

function rankRow(label, value) {
  const row = document.createElement('div')
  row.className = 'rank-row'
  const span = document.createElement('span')
  const strong = document.createElement('strong')
  span.textContent = label
  strong.textContent = value
  row.append(span, strong)
  return row
}

function emptyRow(label) {
  const row = document.createElement('div')
  row.className = 'empty-row'
  row.textContent = label
  return row
}

function lastSevenDays(source) {
  const byDate = new Map(source.map((day) => [day.date, day]))
  return Array.from({ length: 7 }, (_, index) => {
    const date = shanghaiDateKey(new Date(Date.now() - (6 - index) * 86_400_000))
    return byDate.get(date) || { date, events: 0, totalTokens: 0, total: {}, projects: [] }
  })
}

function smoothPath(points) {
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  let path = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1]
    const current = points[i]
    const middle = (previous.x + current.x) / 2
    path += ` C ${middle} ${previous.y}, ${middle} ${current.y}, ${current.x} ${current.y}`
  }
  return path
}

function svg(tag, attributes) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value))
  return node
}

function dayTokens(day) { return number(day?.total?.totalTokens ?? day?.totalTokens) }
function number(value) { return Number.isFinite(Number(value)) ? Number(value) : 0 }
function formatTokens(value) {
  value = number(value)
  if (value >= 100_000_000) return `${trim(value / 100_000_000)}亿`
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}百万`
  if (value >= 10_000) return `${trim(value / 10_000)}万`
  return Math.round(value).toLocaleString('zh-CN')
}
function formatUsd(value) { return `$${trim(number(value))}` }
function formatChars(value) { return value >= 10_000 ? `${trim(value / 10_000)}万字` : `${Math.round(number(value))}字` }
function trim(value) { return number(value).toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2).replace(/\.0+$|(?<=\.[0-9])0+$/, '') }
function formatTime(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '--' }
function shortDate(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}` : '--' }
function compactReset(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '--'
  const today = shanghaiDateKey(new Date())
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return shanghaiDateKey(date) === today ? time : `${shortDate(value)} ${time}`
}
function weekday(value) { const date = new Date(`${value}T00:00:00+08:00`); return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()] }
function platformLabel(value) { return value === 'darwin' ? 'macOS' : value === 'win32' ? 'Windows' : value === 'linux' ? 'Linux' : value || '未知系统' }
function shanghaiDateKey(date) { return new Date(date.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 10) }
