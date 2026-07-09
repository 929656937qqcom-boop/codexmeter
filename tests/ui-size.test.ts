import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const mainSource = readFileSync('src/main/index.ts', 'utf8')
const preloadSource = readFileSync('src/preload/index.ts', 'utf8')
const preloadBuilderSource = readFileSync('scripts/write-preload-cjs.cjs', 'utf8')
const appSource = readFileSync('src/renderer/App.vue', 'utf8')
const stylesSource = readFileSync('src/renderer/styles.css', 'utf8')

function numericProperty(source: string, property: string): number {
  const match = source.match(new RegExp(`${property}:\\s*(\\d+)`))
  if (!match) {
    throw new Error(`Missing numeric property: ${property}`)
  }

  return Number(match[1])
}

function mainWindowNumericProperty(source: string, property: string): number {
  const match = source.match(new RegExp(`mainWindow = new BrowserWindow\\(\\{[\\s\\S]*?${property}:\\s*(\\d+)`))
  if (!match) {
    throw new Error(`Missing main window numeric property: ${property}`)
  }

  return Number(match[1])
}

function selectorNumericProperty(source: string, selector: string, property: string): number {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{[^}]*${property}:\\s*(\\d+)`, 's'))
  if (!match) {
    throw new Error(`Missing ${property} for selector: ${selector}`)
  }

  return Number(match[1])
}

function selectorBlock(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`, 's'))
  if (!match) {
    throw new Error(`Missing selector: ${selector}`)
  }

  return match[0]
}

describe('desktop sizing', () => {
  it('keeps the main window at tool-window scale', () => {
    expect(mainWindowNumericProperty(mainSource, 'width')).toBeLessThanOrEqual(430)
    expect(mainWindowNumericProperty(mainSource, 'height')).toBeLessThanOrEqual(360)
    expect(mainSource).toContain('frame: false')
    expect(mainSource).toContain('transparent: true')
    expect(mainSource).toContain("backgroundColor: '#00000000'")
  })

  it('renders the main view as a dark reference-style quota dashboard', () => {
    expect(appSource).toContain('dashboard-panel')
    expect(appSource).toContain('dashboard-status-strip')
    expect(appSource).toContain('dashboard-view-tabs')
    expect(appSource).toContain('activeDashboardView')
    expect(appSource).toContain('refreshDashboardData')
    expect(appSource).toContain('quota-dial-grid')
    expect(appSource).toContain('quota-dial-card')
    expect(appSource).toContain('quota-dial')
    expect(appSource).toContain('quotaDialStyle')
    expect(appSource).toContain('dashboard-control-strip')
    expect(appSource).toContain('window-control-strip')
    expect(appSource).toContain('window-control-button')
    expect(appSource).toContain('minimizeMainWindow')
    expect(appSource).toContain('closeMainWindow')
    expect(appSource).toContain('widget-control-button')
    expect(appSource).toContain('link-status-pill')
    expect(appSource).toContain('reset-card-list')
    expect(appSource).toContain('reset-card-list-head')
    expect(appSource).toContain('reset-card-row')
    expect(appSource).toContain('resetCards.slice(0, 3)')
    expect(appSource).toContain('resetCardCompactExpiryText')
    expect(appSource).toContain('resetCards.length')
    expect(appSource).toContain('可提前重置额度窗口')
    expect(appSource).toContain('usage-analytics-panel')
    expect(appSource).toContain('usage-period-grid')
    expect(appSource).toContain('usage-split-strip')
    expect(appSource).toContain('usage-rank-grid')
    expect(appSource).toContain('usage-task-board')
    expect(appSource).toContain('getUsageSummary')
    expect(mainSource).toContain("ipcMain.handle('usage:summary'")
    expect(preloadSource).toContain('getUsageSummary')
    expect(preloadBuilderSource).toContain('getUsageSummary')
    expect(appSource).not.toContain('reset-card-grid')
    expect(appSource).not.toContain('reset-card-tile')
    expect(appSource).not.toContain('reset-strip')
    expect(appSource).not.toContain('desktop-hero')
    expect(appSource).not.toContain('usage-section')
    expect(appSource).not.toContain('connection-strip')
    expect(appSource).not.toContain('NProgress')
    expect(stylesSource).toContain('#07111f')
    expect(stylesSource).toContain('conic-gradient')
    expect(selectorNumericProperty(stylesSource, '.dashboard-panel', 'width')).toBeLessThanOrEqual(400)
    expect(selectorNumericProperty(stylesSource, '.dashboard-panel', 'height')).toBeLessThanOrEqual(336)
    expect(selectorNumericProperty(stylesSource, '.dashboard-panel', 'border-radius')).toBeLessThanOrEqual(16)
    expect(selectorNumericProperty(stylesSource, '.window-control-button', 'width')).toBeLessThanOrEqual(24)
    expect(selectorNumericProperty(stylesSource, '.window-control-button', 'height')).toBeLessThanOrEqual(24)
    expect(selectorNumericProperty(stylesSource, '.dashboard-view-tabs', 'height')).toBeLessThanOrEqual(20)
    expect(selectorNumericProperty(stylesSource, '.dashboard-control-strip', 'height')).toBeLessThanOrEqual(32)
    expect(selectorNumericProperty(stylesSource, '.quota-dial-card', 'height')).toBeLessThanOrEqual(108)
    expect(selectorNumericProperty(stylesSource, '.quota-dial', 'width')).toBeLessThanOrEqual(72)
    expect(selectorNumericProperty(stylesSource, '.reset-card-list', 'height')).toBeLessThanOrEqual(76)
    expect(selectorNumericProperty(stylesSource, '.usage-analytics-panel', 'margin-top')).toBeLessThanOrEqual(8)
  })

  it('starts the widget as a compact floating ball', () => {
    expect(mainSource).toContain('WIDGET_COLLAPSED_SIZE')
    expect(mainSource).toContain('const WIDGET_COLLAPSED_SIZE = { width: 68, height: 68 }')
    expect(selectorNumericProperty(stylesSource, '.widget-shell.is-collapsed', 'width')).toBeLessThanOrEqual(68)
    expect(selectorNumericProperty(stylesSource, '.widget-orb', 'width')).toBe(56)
    expect(appSource).toContain('widget-orb-meter')
    expect(appSource).toContain('widget-orb-gauge')
    expect(appSource).toContain('widget-orb-value')
    expect(appSource).toContain('widget-orb-label')
    expect(appSource).toContain('widgetOrbStyle')
    expect(appSource).toContain('5H')
    expect(appSource).not.toContain('widget-orb-progress')
    expect(appSource).not.toContain('widget-progress-arc is-weekly')
    expect(appSource).not.toContain('widget-liquid-window')
    expect(appSource).not.toContain('widget-liquid-fill')
    expect(appSource).not.toContain('widget-wave-path')
    expect(appSource).not.toContain('widget-bubble')
    expect(appSource).not.toContain('widget-week-label')
    expect(appSource).not.toContain('widget-orb-mark')
    expect(appSource).not.toContain('widget-orb-primary')
    expect(appSource).not.toContain('widget-badge-meta')
    expect(appSource).not.toContain('widget-badge-refresh')
    expect(stylesSource).toContain('.widget-orb::before')
    expect(stylesSource).toContain('backdrop-filter: blur(20px)')
    expect(selectorNumericProperty(stylesSource, '.widget-orb-value', 'font-size')).toBeGreaterThanOrEqual(18)
    expect(selectorNumericProperty(stylesSource, '.widget-orb-value', 'font-size')).toBeLessThanOrEqual(20)
    expect(selectorNumericProperty(stylesSource, '.widget-orb-label', 'font-size')).toBeLessThanOrEqual(9)
    expect(stylesSource).toContain('--widget-five-ring')
    expect(stylesSource).toContain('conic-gradient')
    expect(stylesSource).toContain('#00bfa5')
    expect(selectorBlock(stylesSource, '.widget-orb::before')).not.toContain('filter: blur')
    expect(stylesSource).not.toContain('#7c4dff')
    expect(stylesSource).not.toContain('.widget-orb::after')
    expect(stylesSource).not.toContain('widget-liquid-window')
    expect(stylesSource).not.toContain('widget-wave-move')
    expect(stylesSource).not.toContain('widget-bubble-rise')
    expect(stylesSource).not.toContain('stroke-dasharray: 100')
    expect(stylesSource).not.toContain('transform: rotate(-90deg)')
  })

  it('shows a compact peek card with quota details and reset card expirations', () => {
    expect(mainSource).toContain("ipcMain.handle('widget:setExpanded'")
    expect(mainSource).toContain('WIDGET_EXPANDED_SIZE')
    expect(mainSource).toContain('width: 136')
    expect(mainSource).toContain('height: 178')
    expect(preloadSource).toContain('setWidgetExpanded')
    expect(preloadBuilderSource).toContain('setWidgetExpanded')
    expect(appSource).toContain('showWidgetDetails')
    expect(appSource).toContain('widget-peek')
    expect(appSource).toContain('widget-peek-card')
    expect(appSource).toContain('widget-peek-row')
    expect(appSource).toContain('widget-peek-ring')
    expect(appSource).toContain('widget-peek-value')
    expect(appSource).toContain('widget-peek-reset')
    expect(appSource).toContain('widgetPeekFiveUpdate')
    expect(appSource).toContain('widgetPeekWeeklyUpdate')
    expect(appSource).toContain('widgetPeekFiveStyle')
    expect(appSource).toContain('widgetPeekWeeklyStyle')
    expect(appSource).toContain('widgetPeekDialStyle')
    expect(stylesSource).toContain('--widget-peek-ring')
    expect(stylesSource).toContain('--widget-week-ring')
    expect(stylesSource).not.toContain('currentColor 0 74%')
    expect(appSource).toContain('widgetResetCardPeek')
    expect(appSource).toContain('resetCards.length')
  })

  it('shows details from hover with delayed open and delayed close', () => {
    expect(appSource).toContain('let widgetHoverOpenTimer')
    expect(appSource).toContain('let widgetHoverCloseTimer')
    expect(appSource).toContain('scheduleWidgetHoverDetails')
    expect(appSource).toContain('scheduleWidgetDetailsClose')
    expect(appSource).toContain('clearWidgetHoverTimers')
    expect(appSource).toContain('@mouseenter="scheduleWidgetHoverDetails"')
    expect(appSource).toContain('@mouseleave="scheduleWidgetDetailsClose"')
    expect(appSource).toContain('@focus="scheduleWidgetHoverDetails"')
    expect(appSource).toContain('window.setTimeout')
    expect(appSource).toContain('650')
  })

  it('uses a click-delay handler so single click peeks and double click opens the main window', () => {
    expect(mainSource).toContain("ipcMain.handle('widget:openMainWindow'")
    expect(mainSource).toContain('showMainWindow')
    expect(preloadSource).toContain('openMainWindow')
    expect(preloadBuilderSource).toContain('openMainWindow')
    expect(appSource).toContain('openMainFromWidget')
    expect(appSource).toContain('let widgetOrbClickTimer')
    expect(appSource).toContain('function handleWidgetOrbClick')
    expect(appSource).toContain('clearWidgetOrbClickTimer')
    expect(appSource).toContain('widgetOrbClickTimer = window.setTimeout')
    expect(appSource).toContain('openMainFromWidget()')
    expect(appSource).toContain('@click="handleWidgetOrbClick"')
    expect(appSource).not.toContain('@click="showWidgetHoverDetails"')
    expect(appSource).toContain('widget-peek-open')
    expect(appSource).toContain('@click.stop="openMainFromWidget"')
  })

  it('wires frameless main-window controls to the host window', () => {
    expect(mainSource).toContain("ipcMain.handle('window:minimizeMain'")
    expect(mainSource).toContain('mainWindow?.minimize()')
    expect(mainSource).toContain("ipcMain.handle('window:closeMain'")
    expect(mainSource).toContain('mainWindow?.close()')
    expect(preloadSource).toContain('minimizeMainWindow')
    expect(preloadSource).toContain('closeMainWindow')
    expect(preloadBuilderSource).toContain('minimizeMainWindow')
    expect(preloadBuilderSource).toContain('closeMainWindow')
  })

  it('waits for the widget window resize before rendering the expanded panel', () => {
    expect(mainSource).toContain(
      'widgetWindow.setBounds(widgetBoundsFor(expanded ? WIDGET_EXPANDED_SIZE : WIDGET_COLLAPSED_SIZE), false)'
    )
    expect(mainSource).not.toContain(
      'widgetWindow.setBounds(widgetBoundsFor(expanded ? WIDGET_EXPANDED_SIZE : WIDGET_COLLAPSED_SIZE), true)'
    )
    expect(appSource).toContain('let widgetExpansionRequestId = 0')
    expect(appSource).not.toContain('async function setWidgetExpanded(value: boolean): Promise<void> {\n  widgetExpanded.value = value')
    expect(appSource).toContain('const requestId = ++widgetExpansionRequestId')
    expect(appSource).toContain('if (requestId === widgetExpansionRequestId)')
  })
})
