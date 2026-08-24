import { describe, expect, it } from 'vitest'
import { chatMessagesUrl, chatSendBody } from '../client/panel/ChatPane.tsx'

describe('anchored chat request scope contract', () => {
  it('carries the same workspace scope in anchored GET and POST requests', () => {
    const cwd = 'D:\\Work Buddy\\client-a'
    const url = new URL(chatMessagesUrl('thread-shared', cwd), 'http://local')

    expect(url.pathname).toBe('/yolo/session/messages')
    expect(url.searchParams.get('thread')).toBe('thread-shared')
    expect(url.searchParams.get('cwd')).toBe(cwd)
    expect(chatSendBody('继续讨论交付时间', 'thread-shared', cwd)).toEqual({
      text: '继续讨论交付时间',
      thread: 'thread-shared',
      cwd,
    })
  })

  it('leaves the resident thread on the server default workspace', () => {
    expect(chatMessagesUrl()).toBe('/yolo/session/messages')
    expect(chatSendBody('总结今天的进展')).toEqual({ text: '总结今天的进展' })
  })

  it('adds the controller-owned id without changing the conversation scope', () => {
    expect(chatSendBody('继续跟进', undefined, undefined, 'client-request-0001')).toEqual({
      text: '继续跟进',
      client_request_id: 'client-request-0001',
    })
  })
})
