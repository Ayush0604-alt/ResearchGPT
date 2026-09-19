import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

// Accessible tabs (WAI-ARIA tabs pattern): only the selected tab is in the
// tab order; arrow keys, Home and End move between tabs and select them.

interface TabsProps<K extends string> {
  tabs: [K, string][]
  active: K
  onChange: (key: K) => void
  label: string
  children: ReactNode
}

export default function Tabs<K extends string>({
  tabs,
  active,
  onChange,
  label,
  children,
}: TabsProps<K>) {
  const id = useId()
  const refs = useRef(new Map<K, HTMLButtonElement>())

  const select = (index: number) => {
    const [key] = tabs[(index + tabs.length) % tabs.length]
    onChange(key)
    refs.current.get(key)?.focus()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const current = tabs.findIndex(([key]) => key === active)
    const moves: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: tabs.length - 1,
    }
    if (e.key in moves) {
      e.preventDefault()
      select(moves[e.key])
    }
  }

  return (
    <>
      <div
        className="flex gap-0.5 mb-5 border-b border-gray-200 overflow-x-auto"
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
      >
        {tabs.map(([key, text]) => {
          const selected = key === active
          return (
            <button
              key={key}
              ref={(el) => {
                if (el) refs.current.set(key, el)
                else refs.current.delete(key)
              }}
              id={`${id}-tab-${key}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${id}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(key)}
              className={`px-4 py-2 text-sm whitespace-nowrap transition-colors border-b-2 -mb-px ${
                selected
                  ? 'border-brand-600 text-brand-600 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {text}
            </button>
          )
        })}
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${active}`}
        tabIndex={0}
        className="card-p min-h-64"
      >
        {children}
      </div>
    </>
  )
}
