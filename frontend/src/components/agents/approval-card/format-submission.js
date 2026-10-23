/**
 * Formats question answers from the ApprovalCard form into an array of strings
 * suitable for the backend API.
 */
export function formatQuestionSubmission(answers) {
  if (!answers) return [];

  // If already an array
  const entries = Array.isArray(answers)
    ? answers
    : Object.keys(answers)
        .sort((a, b) => {
          const numA = parseInt(a.replace(/\D/g, ''), 10);
          const numB = parseInt(b.replace(/\D/g, ''), 10);
          if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
          return a.localeCompare(b);
        })
        .map((k) => answers[k]);

  return entries.map((entry) => {
    if (entry === null || entry === undefined) {
      return '[No Preference]';
    }

    if (typeof entry === 'object' && entry.status === 'skipped') {
      return '[No Preference]';
    }

    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      return trimmed.length > 0 ? trimmed : '[No Preference]';
    }

    if (Array.isArray(entry)) {
      if (entry.length === 0) return '[No Preference]';
      const parts = entry
        .map((item) => {
          if (!item) return '';
          if (typeof item === 'string') return item;
          if (item.label) return item.label;
          if (item.value) return item.value;
          return String(item);
        })
        .filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : '[No Preference]';
    }

    if (typeof entry === 'object') {
      if (entry.label) return entry.label;
      if (entry.value) return entry.value;
      return '[No Preference]';
    }

    return String(entry);
  });
}
