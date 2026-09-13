/**
 * Safe, dependency-free math evaluator and quick unit converter.
 * Handles standard arithmetic (+ - * / ^ % ), parenthesis, and common conversions.
 */

// Basic math expression detection
const MATH_PATTERN = /^[\d\s+\-*/^%().,eE]+$/

export function evaluateMath(query) {
  if (!query) return null
  let q = query.trim()

  // Strip leading '=' if present
  if (q.startsWith('=')) {
    q = q.slice(1).trim()
  }

  // Quick unit conversions check
  const conversion = evaluateConversion(q)
  if (conversion) return conversion

  // Check if expression looks like math and has at least one operator
  if (!MATH_PATTERN.test(q)) return null
  if (!/[+\-*/^%]/.test(q)) return null

  try {
    // Sanitize: replace '^' with '**'
    const sanitized = q.replace(/\^/g, '**')
    // Safety check: ensure no harmful characters
    if (!/^[\d\s+\-*/%().eE]+$/.test(sanitized)) return null

    // Safe evaluation using Function with strict mode
    // eslint-disable-next-line no-new-func
    const result = Function(`'use strict'; return (${sanitized})`)()
    if (typeof result !== 'number' || !Number.isFinite(result)) return null

    // Format number nicely
    const formatted = Number.isInteger(result)
      ? result.toLocaleString()
      : Number(result.toFixed(6)).toLocaleString()

    return {
      type: 'math',
      expression: q,
      result: formatted,
      raw: result,
    }
  } catch {
    return null
  }
}

function evaluateConversion(query) {
  const match = /^([\d.,]+)\s*([a-zA-Z°]+)\s*(?:to|in)\s*([a-zA-Z°]+)$/i.exec(query)
  if (!match) return null

  const val = parseFloat(match[1].replace(/,/g, ''))
  if (Number.isNaN(val)) return null

  const from = match[2].toLowerCase()
  const to = match[3].toLowerCase()

  // Temperature
  if ((from === 'c' || from === 'celsius' || from === '°c') && (to === 'f' || to === 'fahrenheit' || to === '°f')) {
    const res = (val * 9) / 5 + 32
    return { type: 'conversion', expression: query, result: `${res.toFixed(1)} °F` }
  }
  if ((from === 'f' || from === 'fahrenheit' || from === '°f') && (to === 'c' || to === 'celsius' || to === '°c')) {
    const res = ((val - 32) * 5) / 9
    return { type: 'conversion', expression: query, result: `${res.toFixed(1)} °C` }
  }

  // Distance / Length
  const lengthToMeters = {
    km: 1000,
    kilometer: 1000,
    kilometers: 1000,
    m: 1,
    meter: 1,
    meters: 1,
    cm: 0.01,
    centimeter: 0.01,
    centimeters: 0.01,
    mm: 0.001,
    mi: 1609.344,
    mile: 1609.344,
    miles: 1609.344,
    yd: 0.9144,
    yard: 0.9144,
    yards: 0.9144,
    ft: 0.3048,
    foot: 0.3048,
    feet: 0.3048,
    in: 0.0254,
    inch: 0.0254,
    inches: 0.0254,
  }

  if (lengthToMeters[from] && lengthToMeters[to]) {
    const inMeters = val * lengthToMeters[from]
    const converted = inMeters / lengthToMeters[to]
    return {
      type: 'conversion',
      expression: query,
      result: `${Number(converted.toFixed(4)).toLocaleString()} ${to}`,
    }
  }

  // Weight / Mass
  const weightToGrams = {
    kg: 1000,
    kilogram: 1000,
    kilograms: 1000,
    g: 1,
    gram: 1,
    grams: 1,
    mg: 0.001,
    lb: 453.592,
    lbs: 453.592,
    pound: 453.592,
    pounds: 453.592,
    oz: 28.3495,
    ounce: 28.3495,
    ounces: 28.3495,
  }

  if (weightToGrams[from] && weightToGrams[to]) {
    const inGrams = val * weightToGrams[from]
    const converted = inGrams / weightToGrams[to]
    return {
      type: 'conversion',
      expression: query,
      result: `${Number(converted.toFixed(4)).toLocaleString()} ${to}`,
    }
  }

  // Digital storage
  const storageToBytes = {
    b: 1,
    byte: 1,
    bytes: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
    tb: 1024 * 1024 * 1024 * 1024,
  }

  if (storageToBytes[from] && storageToBytes[to]) {
    const inBytes = val * storageToBytes[from]
    const converted = inBytes / storageToBytes[to]
    return {
      type: 'conversion',
      expression: query,
      result: `${Number(converted.toFixed(3)).toLocaleString()} ${to.toUpperCase()}`,
    }
  }

  return null
}
