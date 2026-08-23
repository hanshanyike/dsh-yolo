// W4 regression against the real Edge host: an Enter key emitted while a
// Chinese IME composition is active must not submit the capture draft. The
// same draft is submitted only after composition has ended.

import { test, expect } from '@playwright/test'
import {
  connectApi,
  createFixtures,
  openYoloPanel,
  todayStr,
  uid,
  waitForDashboard,
  type Api,
} from '../helpers.ts'

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => {
  api = await connectApi()
})

test.afterAll(async () => {
  await api.close()
})

test.beforeEach(async () => {
  fx = createFixtures(api)
})

test.afterEach(async () => {
  await fx.dispose()
})

test('W4: 中文输入法组合态 Enter 不误提交，组合结束后默认今日入库', async ({ page }) => {
  const title = uid('确认中文版发布说明')
  const quickAdds: Array<Record<string, unknown>> = []
  page.on('request', (request) => {
    if (!request.url().endsWith('/yolo/actions') || request.method() !== 'POST') return
    const body = request.postDataJSON() as Record<string, unknown>
    if (body.action === 'quick_add') quickAdds.push(body)
  })

  await openYoloPanel(page)
  const capture = page.locator('.capture .cap-input')
  await capture.fill(title)

  await capture.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
    bubbles: true,
    cancelable: true,
  })
  await page.waitForTimeout(500)
  expect(quickAdds).toHaveLength(0)
  await expect(capture).toHaveValue(title)

  await capture.press('Enter')
  const dashboard = await waitForDashboard(
    api,
    (data) => data.todos?.some((todo: Record<string, unknown>) => todo.title === title),
    { label: `capture ${title} to land after composition ended` },
  )
  const created = dashboard.todos.find((todo: Record<string, unknown>) => todo.title === title)
  expect(quickAdds).toHaveLength(1)
  expect(created).toMatchObject({ title, status: 'pending', due_at: todayStr() })
  fx.trackTodo(String(created.id))
})
