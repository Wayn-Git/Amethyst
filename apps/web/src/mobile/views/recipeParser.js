export function parseRecipe(text) {
  const result = { ingredients: [], steps: [] }
  if (!text) return result
  let section = ''

  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const heading = line.replace(/^#{1,6}\s*/, '').replace(/[*_`]/g, '').replace(/:$/, '').toLowerCase()
    if (/^(ingredients|what you.?ll need)$/.test(heading)) {
      section = 'ingredients'
      continue
    }
    if (/^(steps|instructions|method|directions|preparation)$/.test(heading)) {
      section = 'steps'
      continue
    }
    if (/^#{1,6}\s/.test(line) || /^(notes|nutrition|source|equipment)\s*:?$/i.test(line)) {
      section = ''
      continue
    }
    const item = line.replace(/^[-*+]\s+/, '').replace(/^\[[ xX]\]\s*/, '').replace(/^\d+[.)]\s*/, '').trim()
    if (!item) continue
    if (section === 'ingredients') result.ingredients.push(item)
    if (section === 'steps') result.steps.push(item)
  }
  return result
}
