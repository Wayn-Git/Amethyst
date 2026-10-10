import { useState, useMemo } from 'react'
import Icon from '../Icon.jsx'

export default function DataTable({ data }) {
  const columns = Array.isArray(data?.columns) ? data.columns : []
  const rawRows = Array.isArray(data?.rows) ? data.rows : []
  const [filter, setFilter] = useState('')
  const [copied, setCopied] = useState(false)

  const filteredRows = useMemo(() => {
    if (!filter.trim()) return rawRows
    const term = filter.toLowerCase().trim()
    return rawRows.filter((row) =>
      row.some((cell) => String(cell ?? '').toLowerCase().includes(term))
    )
  }, [rawRows, filter])

  const copyAsCsv = () => {
    const escapeCell = (val) => {
      const str = String(val ?? '')
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }

    const headerLine = columns.map(escapeCell).join(',')
    const dataLines = filteredRows.map((r) => r.map(escapeCell).join(','))
    const csv = [headerLine, ...dataLines].join('\n')

    navigator.clipboard.writeText(csv).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (!columns.length && !rawRows.length) return null

  return (
    <div className="data-table-widget">
      <div className="data-table-header">
        <div className="table-header-left">
          <Icon name="grid" size={16} />
          <span className="table-title">{data.title || 'Data Table'}</span>
          <span className="table-row-count">
            {filteredRows.length} {filteredRows.length === 1 ? 'row' : 'rows'}
          </span>
        </div>
        <div className="table-header-right">
          <div className="table-filter-box">
            <input
              type="text"
              placeholder="Filter table..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="table-filter-input"
            />
            {filter && (
              <button
                type="button"
                className="table-filter-clear"
                onClick={() => setFilter('')}
                aria-label="Clear filter"
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <button
            type="button"
            className="table-action-btn"
            onClick={copyAsCsv}
            title="Copy as CSV"
            aria-label="Copy as CSV"
          >
            <Icon name={copied ? 'check' : 'copy'} size={14} />
            <span>{copied ? 'Copied' : 'CSV'}</span>
          </button>
        </div>
      </div>

      <div className="data-table-container">
        <table className="data-table-element">
          <thead>
            <tr>
              {columns.map((col, idx) => (
                <th key={idx} scope="col">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length > 0 ? (
              filteredRows.map((row, rowIdx) => (
                <tr key={rowIdx}>
                  {row.map((cell, cellIdx) => (
                    <td key={cellIdx}>
                      {cell !== null && cell !== undefined ? String(cell) : '—'}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length || 1} className="table-empty-cell">
                  No matching rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
