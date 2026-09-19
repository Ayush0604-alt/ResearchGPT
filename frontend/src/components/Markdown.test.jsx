import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Markdown from './Markdown'

function renderMd(text) {
  return render(<Markdown>{text}</Markdown>).container
}

describe('Markdown', () => {
  it('renders common markdown, including GFM tables', () => {
    const el = renderMd('## Title\n\n**bold** and `code`\n\n| a | b |\n|---|---|\n| 1 | 2 |')
    expect(el.querySelector('h2')).toHaveTextContent('Title')
    expect(el.querySelector('strong')).toHaveTextContent('bold')
    expect(el.querySelector('table td')).toHaveTextContent('1')
  })

  it('never turns raw HTML into elements', () => {
    const el = renderMd('<img src=x onerror="alert(1)"> <script>alert(2)</script> <b>hi</b>')
    expect(el.querySelector('img')).toBeNull()
    expect(el.querySelector('script')).toBeNull()
    expect(el.querySelector('b')).toBeNull()
    expect(el.innerHTML).not.toContain('onerror')
  })

  it('drops javascript: links', () => {
    const el = renderMd('[click](javascript:alert(1))')
    const href = el.querySelector('a')?.getAttribute('href') || ''
    expect(href).not.toMatch(/javascript:/i)
  })

  it('opens links in a new tab without an opener', () => {
    const a = renderMd('[paper](https://arxiv.org/abs/1234.5678)').querySelector('a')
    expect(a).toHaveAttribute('href', 'https://arxiv.org/abs/1234.5678')
    expect(a).toHaveAttribute('target', '_blank')
    expect(a.getAttribute('rel')).toContain('noopener')
  })

  it('renders nothing for empty content', () => {
    expect(renderMd(null).textContent).toBe('')
  })
})
