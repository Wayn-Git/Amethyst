export const RATING_TIERS = {
  5: {
    stars: 5,
    label: 'Essential',
    shortLabel: 'Essential',
    color: '#f59e0b',
    badgeClass: 'lib-rating-tier--essential',
    description: 'Core reference & foundational knowledge. Prioritized in AI retrieval.',
  },
  4: {
    stars: 4,
    label: 'High Impact',
    shortLabel: 'High Impact',
    color: '#fbbf24',
    badgeClass: 'lib-rating-tier--high',
    description: 'Highly valuable insights and top-tier reference material.',
  },
  3: {
    stars: 3,
    label: 'Useful',
    shortLabel: 'Useful',
    color: '#60a5fa',
    badgeClass: 'lib-rating-tier--useful',
    description: 'Solid reference material with relevant practical context.',
  },
  2: {
    stars: 2,
    label: 'Skimmed',
    shortLabel: 'Skimmed',
    color: '#94a3b8',
    badgeClass: 'lib-rating-tier--skimmed',
    description: 'Reviewed with minor utility or basic reference value.',
  },
  1: {
    stars: 1,
    label: 'Low Value',
    shortLabel: 'Low Value',
    color: '#64748b',
    badgeClass: 'lib-rating-tier--low',
    description: 'Minimal utility or obsolete; candidate for archiving.',
  },
}

export function getRatingTier(rating) {
  if (!rating || typeof rating !== 'number' || rating < 1) return null
  const rounded = Math.min(5, Math.max(1, Math.round(rating)))
  return RATING_TIERS[rounded] || null
}
