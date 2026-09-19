import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'

// Model output and paper text are untrusted. react-markdown never renders raw
// HTML and drops javascript: URLs; rehype-sanitize is a second layer on top.
// Never replace this with dangerouslySetInnerHTML: an XSS here could read the
// user's API key from localStorage.

function ExternalLink({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  )
}

export default function Markdown({ children, className = 'prose-content' }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{ a: ExternalLink }}
      >
        {children || ''}
      </ReactMarkdown>
    </div>
  )
}
