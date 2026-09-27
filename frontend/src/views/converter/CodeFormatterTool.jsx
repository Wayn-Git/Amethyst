import { useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { useApp } from '../../store.jsx'

const SAMPLES = {
  json: `{\n  "name": "Amethyst",\n  "version": "1.0.0",\n  "modules": ["Converter", "Tasks", "Mail", "Notes"],\n  "local_only": true\n}`,
  html: `<!DOCTYPE html>\n<html>\n<head><title>Amethyst</title></head>\n<body><div class="app"><header><h1>Private Tools</h1></header><main><p>Fast, local conversion suite.</p></main></div></body>\n</html>`,
  css: `body{margin:0;padding:0;background:#0d0e12;color:#fff;}.card{padding:16px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:#16171c;}`,
  javascript: `function calculateTotal(items, taxRate){const subtotal = items.reduce((acc,item)=>acc+item.price*item.qty,0);return subtotal+(subtotal*taxRate);}`,
  sql: `SELECT u.id, u.username, count(t.id) as task_count FROM users u LEFT JOIN tasks t ON u.id = t.user_id WHERE u.active = 1 GROUP BY u.id, u.username ORDER BY task_count DESC;`,
  xml: `<?xml version="1.0" encoding="UTF-8"?><note><to>User</to><from>Amethyst</from><heading>Reminder</heading><body>Local-first file conversion ready.</body></note>`,
  markdown: `# Amethyst Tools\n\n- Fast file conversion\n- PDF tools\n- Audio and video processing\n- OCR & QR generation`,
}

export default function CodeFormatterTool() {
  const { toast } = useApp()
  const [lang, setLang] = useState('json')
  const [code, setCode] = useState(SAMPLES.json)
  const [error, setError] = useState(null)
  const [indent, setIndent] = useState('2')
  const [copied, setCopied] = useState(false)

  const handleLangChange = (newLang) => {
    setLang(newLang)
    setError(null)
    setCode(SAMPLES[newLang] || '')
  }

  const formatCode = () => {
    setError(null)
    if (!code.trim()) return

    try {
      if (lang === 'json') {
        const parsed = JSON.parse(code)
        setCode(JSON.stringify(parsed, null, indent === 'tab' ? '\t' : Number(indent)))
        toast('JSON formatted successfully!', 'good')
      } else if (lang === 'css') {
        let formatted = code
          .replace(/\s*([\{\};:,])\s*/g, '$1')
          .replace(/;\s*/g, ';\n  ')
          .replace(/\{\s*/g, ' {\n  ')
          .replace(/\s*\}\s*/g, '\n}\n')
        setCode(formatted.trim())
        toast('CSS formatted!', 'good')
      } else if (lang === 'html' || lang === 'xml') {
        let formatted = code
          .replace(/>\s*</g, '>\n<')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .join('\n')
        setCode(formatted)
        toast(`${lang.toUpperCase()} formatted!`, 'good')
      } else if (lang === 'sql') {
        const keywords = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'LEFT JOIN', 'INNER JOIN', 'RIGHT JOIN', 'JOIN', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE']
        let formatted = code
        keywords.forEach((kw) => {
          const re = new RegExp(`\\b${kw}\\b`, 'gi')
          formatted = formatted.replace(re, `\n${kw}`)
        })
        setCode(formatted.trim())
        toast('SQL formatted!', 'good')
      } else if (lang === 'javascript') {
        let formatted = code
          .replace(/;\s*/g, ';\n')
          .replace(/\{\s*/g, ' {\n  ')
          .replace(/\}\s*/g, '\n}\n')
        setCode(formatted.trim())
        toast('JavaScript formatted!', 'good')
      } else {
        toast('Code formatted', 'good')
      }
    } catch (err) {
      setError(err.message)
      toast(`Formatting error: ${err.message}`, 'bad')
    }
  }

  const minifyCode = () => {
    setError(null)
    if (!code.trim()) return

    try {
      if (lang === 'json') {
        const parsed = JSON.parse(code)
        setCode(JSON.stringify(parsed))
        toast('JSON minified!', 'good')
      } else if (lang === 'css' || lang === 'html' || lang === 'xml') {
        const min = code.replace(/\s+/g, ' ').replace(/\s*([\{\};:,>])\s*/g, '$1').trim()
        setCode(min)
        toast('Minified!', 'good')
      } else {
        const min = code.replace(/\s+/g, ' ').trim()
        setCode(min)
        toast('Minified!', 'good')
      }
    } catch (err) {
      setError(err.message)
      toast(`Minifying error: ${err.message}`, 'bad')
    }
  }

  const copyCode = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    toast('Code copied to clipboard!', 'good')
    setTimeout(() => setCopied(false), 2000)
  }

  const downloadCode = () => {
    const extMap = {
      json: 'json',
      html: 'html',
      css: 'css',
      javascript: 'js',
      sql: 'sql',
      xml: 'xml',
      markdown: 'md',
    }
    const ext = extMap[lang] || 'txt'
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `formatted_code.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const lineCount = code ? code.split('\n').length : 0
  const charCount = code.length

  return (
    <div className="fc-tool-workspace">
      {/* Language Tabs */}
      <div className="fc-cat-tabs mb-4">
        {[
          { id: 'json', label: 'JSON' },
          { id: 'html', label: 'HTML' },
          { id: 'css', label: 'CSS' },
          { id: 'javascript', label: 'JavaScript' },
          { id: 'sql', label: 'SQL' },
          { id: 'xml', label: 'XML' },
          { id: 'markdown', label: 'Markdown' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`fc-cat-tab${lang === tab.id ? ' is-active' : ''}`}
            onClick={() => handleLangChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Editor Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800 mb-4">
        <div className="flex items-center gap-2">
          {lang === 'json' && (
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span>Indentation:</span>
              <select
                className="fc-select text-xs h-7 py-0"
                value={indent}
                onChange={(e) => setIndent(e.target.value)}
              >
                <option value="2">2 spaces</option>
                <option value="4">4 spaces</option>
                <option value="tab">Tab</option>
              </select>
            </div>
          )}

          <div className="text-xs text-slate-400 font-mono">
            <span>{lineCount} lines</span>
            <span className="mx-1.5">·</span>
            <span>{charCount} chars</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="fc-btn fc-btn-primary text-xs h-8 py-0"
            onClick={formatCode}
          >
            <Icon name="check" size={13} />
            <span>Beautify / Format</span>
          </button>

          <button
            type="button"
            className="fc-btn fc-btn-secondary text-xs h-8 py-0"
            onClick={minifyCode}
          >
            <Icon name="compress" size={13} />
            <span>Minify</span>
          </button>

          <button
            type="button"
            className="fc-btn fc-btn-secondary text-xs h-8 py-0"
            onClick={copyCode}
          >
            <Icon name={copied ? 'check' : 'copy'} size={13} />
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            type="button"
            className="fc-btn fc-btn-secondary text-xs h-8 py-0"
            onClick={downloadCode}
          >
            <Icon name="download" size={13} />
            <span>Download</span>
          </button>

          <button
            type="button"
            className="fc-btn fc-btn-danger-ghost text-xs h-8 py-0"
            onClick={() => setCode('')}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Syntax Error Alert */}
      {error && (
        <div className="fc-error-banner mb-3">
          <div className="flex items-center gap-2">
            <Icon name="alert" size={16} />
            <span>Syntax Error: {error}</span>
          </div>
        </div>
      )}

      {/* Code Textarea */}
      <textarea
        rows={18}
        className="fc-textarea font-mono text-xs leading-relaxed w-full bg-black/40 border border-slate-800"
        value={code}
        onChange={(e) => {
          setCode(e.target.value)
          setError(null)
        }}
        placeholder={`Paste or type ${lang.toUpperCase()} code here…`}
        spellCheck={false}
      />
    </div>
  )
}
