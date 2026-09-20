import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Button from '../ui/Button.jsx'
import { api } from '../../api.js'

const CATEGORY_ALL = 'all'

/** Grid of automation templates with category filters. */
export default function TemplateGrid({ onSelect }) {
  const [templates, setTemplates] = useState([])
  const [categories, setCategories] = useState([])
  const [activeCategory, setActiveCategory] = useState(CATEGORY_ALL)
  const [loading, setLoading] = useState(true)
  const [actionsList, setActionsList] = useState([])

  useEffect(() => {
    Promise.all([
      api.automationTemplates(),
      api.automationActions()
    ]).then(([templatesData, actionsData]) => {
      setTemplates(templatesData.templates || [])
      setCategories(templatesData.categories || [])
      setActionsList(actionsData.actions || [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const filtered = activeCategory === CATEGORY_ALL
    ? templates
    : templates.filter((t) => t.category === activeCategory)

  if (loading || templates.length === 0) return null

  return (
    <div className="auto-templates" data-enter>
      <div className="auto-templates-head">
        <h3>Templates</h3>
        <div className="auto-template-filters">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`auto-template-filter${activeCategory === cat ? ' is-active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="auto-template-grid">
        {filtered.map((template) => (
          <TemplateCard key={template.id} template={template} actionsList={actionsList} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

function TemplateCard({ template, actionsList, onSelect }) {
  const unavailableIntegrations = (template.required_integrations || []).filter((req) => {
    const hasAvailableAction = actionsList.some(a => a.integration === req && a.available)
    return !hasAvailableAction
  })

  return (
    <div className="auto-template-card">
      <div className="auto-template-card-head">
        <span className={`auto-template-icon auto-template-icon--${template.category}`}>
          <Icon name={template.icon || 'zap'} size={16} />
        </span>
        <Button
          variant="ghost"
          size="small"
          onClick={() => onSelect(template)}
        >
          Add
        </Button>
      </div>
      <h4 className="auto-template-name">{template.name}</h4>
      <p className="auto-template-desc">{template.description}</p>
      <div className="auto-template-meta">
        <Icon name="clock" size={11} />
        <span>
          {template.schedule_type === 'daily_at' && `Daily at ${template.daily_at_time}`}
          {template.schedule_type === 'weekly_at' && `Weekly at ${template.daily_at_time}`}
          {template.schedule_type === 'interval' && `Every ${template.every_minutes}m`}
        </span>
      </div>
      {unavailableIntegrations.map((req) => (
        <div key={req} className="auto-template-warning">
          <Icon name="warning" size={11} />
          <span>{req.charAt(0).toUpperCase() + req.slice(1)} not connected</span>
        </div>
      ))}
      {template.actions && template.actions.length > 0 && (
        <div className="auto-template-tags">
          {template.actions.map(act => (
            <span key={act} className="auto-template-tag">{act}</span>
          ))}
        </div>
      )}
    </div>
  )
}
