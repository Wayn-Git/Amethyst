import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import Icon from './Icon.jsx'
import { useDismiss } from '../hooks/useDismiss.js'

import { safeStorage } from '../lib/storage.js'

const RECENT_PROJECTS_KEY = 'amethyst.recent_workspaces'

function getStoredProjects(current) {
  try {
    const raw = safeStorage.getItem(RECENT_PROJECTS_KEY)
    const list = raw ? JSON.parse(raw) : []
    if (current && !list.includes(current)) {
      list.unshift(current)
    }
    if (list.length === 0) {
      return [
        '/home/wayne/Documents/GitHub/amethyst',
        '/home/wayne/Documents/Amethyst',
      ]
    }
    return list.slice(0, 6)
  } catch {
    return ['/home/wayne/Documents/GitHub/amethyst', '/home/wayne/Documents/Amethyst']
  }
}

function saveStoredProjects(list) {
  safeStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(list))
}

export default function ProjectMenu({ workspace, onWorkspace, onClose, placement = 'down' }) {
  const ref = useRef(null)
  useDismiss(ref, true, { onAway: onClose, onEscape: onClose })

  const [projects, setProjects] = useState(() => getStoredProjects(workspace))
  const [editing, setEditing] = useState(false)
  const [customPath, setCustomPath] = useState('')

  useEffect(() => {
    if (workspace && !projects.includes(workspace)) {
      const next = [workspace, ...projects.filter((p) => p !== workspace)].slice(0, 6)
      setProjects(next)
      saveStoredProjects(next)
    }
  }, [workspace, projects])

  const selectProject = (path) => {
    const next = [path, ...projects.filter((p) => p !== path)].slice(0, 6)
    setProjects(next)
    saveStoredProjects(next)
    onWorkspace(path)
    onClose()
  }

  const handleCustomSubmit = (e) => {
    e.preventDefault()
    const trimmed = customPath.trim()
    if (trimmed) {
      selectProject(trimmed)
    }
  }

  const getBaseName = (path) => {
    if (!path) return 'Amethyst'
    const parts = path.replace(/[/\\]+$/, '').split(/[/\\]/)
    return parts[parts.length - 1] || path
  }

  const isCurrent = (path) => {
    if (!workspace && path.endsWith('amethyst')) return true
    return workspace === path || (workspace && workspace.replace(/\/$/, '') === path.replace(/\/$/, ''))
  }

  return (
    <motion.div
      ref={ref}
      className={`project-menu project-menu--${placement}`}
      initial={{ opacity: 0, y: placement === 'up' ? 6 : -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: placement === 'up' ? 6 : -6, scale: 0.98 }}
      transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="project-menu-head">Opened projects</div>

      <div className="project-menu-list">
        {projects.map((path) => {
          const active = isCurrent(path)
          const name = getBaseName(path)
          return (
            <button
              key={path}
              type="button"
              className={`project-menu-item${active ? ' is-active' : ''}`}
              onClick={() => selectProject(path)}
              title={path}
            >
              <span className="project-item-icon">
                <Icon name="folder" size={14} />
              </span>
              <span className="project-item-text">
                <span className="project-item-name">{name}</span>
                <span className="project-item-path">{path}</span>
              </span>
              {active && <Icon name="check" size={13} className="project-item-check" />}
            </button>
          )
        })}
      </div>

      <div className="project-menu-divider" />

      {editing ? (
        <form onSubmit={handleCustomSubmit} className="project-menu-form">
          <input
            autoFocus
            type="text"
            className="project-menu-input"
            value={customPath}
            onChange={(e) => setCustomPath(e.target.value)}
            placeholder="/path/to/project"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setEditing(false)
              }
            }}
          />
          <button type="submit" className="project-menu-submit-btn">
            Open
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="project-menu-open-btn"
          onClick={() => setEditing(true)}
        >
          <Icon name="folder" size={14} />
          <span>Open another folder...</span>
        </button>
      )}
    </motion.div>
  )
}
