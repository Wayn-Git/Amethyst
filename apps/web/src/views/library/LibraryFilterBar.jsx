import { Button as HouseButton } from '../../components/ui/bento/index.jsx'
import Icon from '../../components/Icon.jsx'

export default function LibraryFilterBar({ selectedKinds = [], selectedCategories = [], selectedTags = [], selectedRatings = [], query = '', onSelectKinds, onSelectCategories, onSelectTags, onSelectRatings, onClearQuery, onClearFilters }) {
  const tokens = [
    ...selectedKinds.map((value) => ['Format', value, () => onSelectKinds(selectedKinds.filter((item) => item !== value))]),
    ...selectedRatings.map((value) => ['Significance', value === '5' ? 'Essential · 5 stars' : 'High impact · 4+ stars', () => onSelectRatings(selectedRatings.filter((item) => item !== value))]),
    ...selectedCategories.map((value) => ['Category', value, () => onSelectCategories(selectedCategories.filter((item) => item !== value))]),
    ...selectedTags.map((value) => [value === 'instagram' || value === 'youtube' || value === 'spotify' || value === 'threads' || value === 'pinterest' || value === 'github' || value === 'x' || value === 'reddit' ? 'Source' : 'Tag', value, () => onSelectTags(selectedTags.filter((item) => item !== value))]),
  ]
  if (!tokens.length && !query) return null
  return <div className="lib-active-filter-shelf" data-enter><div className="lib-active-filter-strip"><span className="lib-active-filter-title">Refining</span>{tokens.map(([type, value, remove]) => <span key={`${type}-${value}`} className="lib-active-filter-chip"><small>{type}</small><span>{type === 'Tag' ? `#${value}` : value}</span><HouseButton type="button" className="lib-active-filter-remove" onClick={remove} aria-label={`Remove ${value}`}><Icon name="x" size={11}/></HouseButton></span>)}{query && <span className="lib-active-filter-chip"><small>Search</small><span>“{query}”</span><HouseButton type="button" className="lib-active-filter-remove" onClick={onClearQuery} aria-label="Clear search"><Icon name="x" size={11}/></HouseButton></span>}<HouseButton type="button" className="lib-active-filter-clear-all" onClick={onClearFilters}>Clear all</HouseButton></div></div>
}
