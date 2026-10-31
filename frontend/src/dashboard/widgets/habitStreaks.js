const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export function bestStreak(historyDays, period, target) {
  const counts = new Map()
  for (const day of historyDays) {
    const date = new Date(`${day}T12:00:00`)
    if (period === 'weekly') date.setDate(date.getDate() - (date.getDay() + 6) % 7)
    const key = dateKey(date)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const periods = [...counts.keys()].sort()
  if (!periods.length) return 0
  let current = 0
  let best = 0
  for (let date = new Date(`${periods[0]}T12:00:00`); dateKey(date) <= periods.at(-1); date.setDate(date.getDate() + (period === 'weekly' ? 7 : 1))) {
    current = (counts.get(dateKey(date)) || 0) >= target ? current + 1 : 0
    best = Math.max(best, current)
  }
  return best
}
