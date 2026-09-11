import { describe, expect, it } from 'vitest'
import { PAGE_KEYS, pageKeyForKeyboard } from '../client/panel/PageTabs.tsx'

describe('assistant page tabs', () => {
  it('exposes home, plan, goals and history with standard keyboard movement', () => {
    expect(PAGE_KEYS).toEqual(['home', 'plan', 'goals', 'history'])
    expect(pageKeyForKeyboard('home', 'ArrowRight')).toBe('plan')
    expect(pageKeyForKeyboard('plan', 'ArrowRight')).toBe('goals')
    expect(pageKeyForKeyboard('home', 'ArrowLeft')).toBe('history')
    expect(pageKeyForKeyboard('plan', 'Home')).toBe('home')
    expect(pageKeyForKeyboard('plan', 'End')).toBe('history')
    expect(pageKeyForKeyboard('home', 'Enter')).toBeNull()
  })
})
