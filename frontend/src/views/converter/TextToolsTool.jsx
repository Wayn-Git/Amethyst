import { useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { useApp } from '../../store.jsx'

export default function TextToolsTool() {
  const { toast } = useApp()
  const [text, setText] = useState('Amethyst is a private, local-first personal operating system.')
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [matchCase, setMatchCase] = useState(false)

  // Real-time Text Statistics
  const stats = useMemo(() => {
    const raw = text || ''
    const charsWithSpaces = raw.length
    const charsNoSpaces = raw.replace(/\s/g, '').length
    const words = raw.trim() ? raw.trim().split(/\s+/).length : 0
    const sentences = raw.split(/[.!?]+/).filter((s) => s.trim().length > 0).length
    const lines = raw.split('\n').length
    const readingTimeMins = Math.ceil(words / 200)

    return {
      words,
      charsWithSpaces,
      charsNoSpaces,
      sentences,
      lines,
      readingTimeMins,
    }
  }, [text])

  // Case transforms
  const transformCase = (type) => {
    if (!text) return
    let res = text

    switch (type) {
      case 'upper':
        res = text.toUpperCase()
        break
      case 'lower':
        res = text.toLowerCase()
        break
      case 'title':
        res = text.replace(/\b[a-z]/g, (char) => char.toUpperCase())
        break
      case 'sentence':
        res = text.toLowerCase().replace(/(^\s*\w|[.!?]\s*\w)/g, (c) => c.toUpperCase())
        break
      case 'camel':
        res = text
          .toLowerCase()
          .replace(/[^a-zA-Z0-9]+(.)/g, (m, chr) => chr.toUpperCase())
        break
      case 'kebab':
        res = text
          .trim()
          .toLowerCase()
          .replace(/[^a-zA-Z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
        break
      case 'snake':
        res = text
          .trim()
          .toLowerCase()
          .replace(/[^a-zA-Z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
        break
      case 'constant':
        res = text
          .trim()
          .toUpperCase()
          .replace(/[^a-zA-Z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
        break
    }

    setText(res)
    toast(`Converted to ${type} case!`, 'good')
  }

  // Find & Replace
  const handleReplace = () => {
    if (!findText) return
    const flags = matchCase ? 'g' : 'gi'
    try {
      const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
      const count = (text.match(regex) || []).length
      setText(text.replace(regex, replaceText))
      toast(`Replaced ${count} occurrence(s)!`, 'good')
    } catch (err) {
      toast('Invalid search query', 'bad')
    }
  }

  // Cleaners
  const removeDuplicates = () => {
    const lines = text.split('\n')
    const unique = Array.from(new Set(lines))
    setText(unique.join('\n'))
    toast(`Removed ${lines.length - unique.length} duplicate line(s)!`, 'good')
  }

  const removeBlankLines = () => {
    const lines = text.split('\n').filter((l) => l.trim().length > 0)
    setText(lines.join('\n'))
    toast('Removed blank lines!', 'good')
  }

  const sortLines = (asc = true) => {
    const lines = text.split('\n')
    lines.sort((a, b) => (asc ? a.localeCompare(b) : b.localeCompare(a)))
    setText(lines.join('\n'))
    toast(`Sorted lines ${asc ? 'A → Z' : 'Z → A'}!`, 'good')
  }

  return (
    <div className="fc-tool-workspace">
      {/* Real-time Statistics Bar */}
      {/* Live Text Telemetry */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 mb-4">
        {[
          { label: 'Words', val: stats.words },
          { label: 'Characters', val: stats.charsWithSpaces },
          { label: 'Chars (No spaces)', val: stats.charsNoSpaces },
          { label: 'Sentences', val: stats.sentences },
          { label: 'Lines', val: stats.lines },
          { label: 'Reading Time', val: `~${stats.readingTimeMins} min` },
        ].map((s) => (
          <div key={s.label} className="p-2.5 rounded-xl bg-[var(--fc-surface)] border border-[var(--fc-border)] text-center shadow-xs">
            <div className="text-lg font-bold font-mono text-[var(--fc-text)]">{s.val}</div>
            <div className="text-[10.5px] font-semibold text-[var(--fc-text-dim)] uppercase tracking-wider">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Case Converters Row */}
      <div className="flex flex-wrap items-center gap-1.5 p-3 rounded-xl bg-[var(--fc-surface)] border border-[var(--fc-border)] shadow-xs mb-4">
        <span className="text-xs font-semibold text-[var(--fc-text-dim)] mr-2">Case:</span>
        {[
          { id: 'upper', label: 'UPPERCASE' },
          { id: 'lower', label: 'lowercase' },
          { id: 'title', label: 'Title Case' },
          { id: 'sentence', label: 'Sentence case' },
          { id: 'camel', label: 'camelCase' },
          { id: 'kebab', label: 'kebab-case' },
          { id: 'snake', label: 'snake_case' },
          { id: 'constant', label: 'CONSTANT_CASE' },
        ].map((c) => (
          <button
            key={c.id}
            type="button"
            className="fc-btn fc-btn-secondary text-xs h-7 py-0 px-2.5 font-mono"
            onClick={() => transformCase(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Find & Replace Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-[var(--fc-surface)] border border-[var(--fc-border)] shadow-xs mb-4">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <input
            type="text"
            className="fc-input text-xs w-40"
            placeholder="Find text…"
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
          />
          <input
            type="text"
            className="fc-input text-xs w-40"
            placeholder="Replace with…"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
          />
          <label className="flex items-center gap-1.5 text-xs text-[var(--fc-text-dim)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={matchCase}
              onChange={(e) => setMatchCase(e.target.checked)}
              className="rounded bg-[var(--fc-surface-2)] border-[var(--fc-border)]"
            />
            <span>Match case</span>
          </label>
          <button
            type="button"
            className="fc-btn fc-btn-secondary text-xs h-7 py-0 px-3"
            onClick={handleReplace}
          >
            Replace All
          </button>
        </div>

        {/* Clean Operations */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="fc-btn fc-btn-secondary text-xs h-7 py-0 px-2.5"
            onClick={removeDuplicates}
            title="Remove duplicate lines"
          >
            Dedupe Lines
          </button>
          <button
            type="button"
            className="fc-btn fc-btn-secondary text-xs h-7 py-0 px-2.5"
            onClick={removeBlankLines}
            title="Remove empty lines"
          >
            Remove Blank
          </button>
          <button
            type="button"
            className="fc-btn fc-btn-secondary text-xs h-7 py-0 px-2.5"
            onClick={() => sortLines(true)}
            title="Sort lines alphabetically"
          >
            Sort A-Z
          </button>
        </div>
      </div>

      {/* Editor Box */}
      <div className="relative">
        <textarea
          className="fc-textarea w-full h-80 p-4 rounded-xl bg-[var(--fc-surface)] border border-[var(--fc-border)] text-[var(--fc-text)] font-mono text-sm leading-relaxed outline-none focus:border-[var(--fc-accent)] transition resize-y shadow-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste or write text to transform…"
        />
        <div className="absolute right-3 bottom-4 flex items-center gap-2">
          <button
            type="button"
            className="fc-btn fc-btn-primary text-xs h-8 py-0 px-3"
            onClick={() => {
              navigator.clipboard.writeText(text)
              toast('Copied text to clipboard!', 'good')
            }}
          >
            <Icon name="copy" size={14} />
            <span>Copy Text</span>
          </button>
          <button
            type="button"
            className="fc-btn fc-btn-danger-ghost text-xs h-8 py-0 px-2.5"
            onClick={() => setText('')}
          >
            <Icon name="trash" size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
