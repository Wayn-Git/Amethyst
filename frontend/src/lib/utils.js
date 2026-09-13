export function cn(...inputs) {
  return inputs
    .flatMap((input) => {
      if (input == null || input === false || input === '') {
        return []
      }

      if (typeof input === 'string' || typeof input === 'number') {
        return [String(input)]
      }

      if (Array.isArray(input)) {
        return cn(...input)
      }

      if (typeof input === 'object') {
        return Object.entries(input)
          .filter(([, value]) => Boolean(value))
          .map(([key]) => key)
      }

      return []
    })
    .join(' ')
}
