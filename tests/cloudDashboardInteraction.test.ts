import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const dashboardSource = readFileSync(new URL('../cloud/public/app.js', import.meta.url), 'utf8')
const dashboardStyles = readFileSync(new URL('../cloud/public/styles.css', import.meta.url), 'utf8')

describe('cloud dashboard daily account metrics', () => {
  it('updates official usage and coverage when a trend day is hovered', () => {
    expect(dashboardSource).toContain("group.addEventListener('mouseenter', () => selectDay(point.day.date, days))")
    expect(dashboardSource).toContain("button.addEventListener('mouseenter', () => selectDay(day.date, days))")
    expect(dashboardSource).toMatch(/function selectDay[\s\S]*renderSelectedAccountMetrics\(days\)/)
  })

  it('uses the selected date for local and official account totals', () => {
    expect(dashboardSource).toContain("day.date === date")
    expect(dashboardSource).toContain('state.data?.officialDailyUsage')
    expect(dashboardSource).toContain('localTokens / officialTokens * 100')
    expect(dashboardSource).toContain('官方数据尚未同步')
  })

  it('provides a forgiving hover target without changing the visible point size', () => {
    expect(dashboardSource).toContain("r: 6, class: 'trend-hit'")
    expect(dashboardSource).toContain("r: 2.2, class: 'trend-dot'")
    expect(dashboardStyles).toContain('.trend-point .trend-hit')
    expect(dashboardStyles).toContain('pointer-events: all')
  })
})
