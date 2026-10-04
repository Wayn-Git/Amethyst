import { useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { useApp } from '../../store.jsx'

const UNIT_CATEGORIES = {
  length: {
    label: 'Length',
    base: 'm',
    units: {
      m: { name: 'Meters (m)', factor: 1 },
      km: { name: 'Kilometers (km)', factor: 1000 },
      cm: { name: 'Centimeters (cm)', factor: 0.01 },
      mm: { name: 'Millimeters (mm)', factor: 0.001 },
      mi: { name: 'Miles (mi)', factor: 1609.344 },
      yd: { name: 'Yards (yd)', factor: 0.9144 },
      ft: { name: 'Feet (ft)', factor: 0.3048 },
      in: { name: 'Inches (in)', factor: 0.0254 },
      nm: { name: 'Nautical Miles (NM)', factor: 1852 },
    },
  },
  mass: {
    label: 'Weight / Mass',
    base: 'kg',
    units: {
      kg: { name: 'Kilograms (kg)', factor: 1 },
      g: { name: 'Grams (g)', factor: 0.001 },
      mg: { name: 'Milligrams (mg)', factor: 0.000001 },
      lb: { name: 'Pounds (lb)', factor: 0.45359237 },
      oz: { name: 'Ounces (oz)', factor: 0.02834952 },
      t: { name: 'Metric Tons (t)', factor: 1000 },
      st: { name: 'Stones (st)', factor: 6.35029318 },
    },
  },
  temperature: {
    label: 'Temperature',
    isSpecial: true,
    units: {
      c: { name: 'Celsius (°C)' },
      f: { name: 'Fahrenheit (°F)' },
      k: { name: 'Kelvin (K)' },
    },
  },
  volume: {
    label: 'Volume',
    base: 'l',
    units: {
      l: { name: 'Liters (L)', factor: 1 },
      ml: { name: 'Milliliters (mL)', factor: 0.001 },
      m3: { name: 'Cubic Meters (m³)', factor: 1000 },
      gal: { name: 'US Gallons (gal)', factor: 3.78541 },
      qt: { name: 'US Quarts (qt)', factor: 0.946353 },
      pt: { name: 'US Pints (pt)', factor: 0.473176 },
      cup: { name: 'US Cups (cup)', factor: 0.24 },
      floz: { name: 'Fluid Ounces (fl oz)', factor: 0.0295735 },
    },
  },
  storage: {
    label: 'Digital Storage',
    base: 'B',
    units: {
      B: { name: 'Bytes (B)', factor: 1 },
      KB: { name: 'Kilobytes (KB)', factor: 1024 },
      MB: { name: 'Megabytes (MB)', factor: 1024 ** 2 },
      GB: { name: 'Gigabytes (GB)', factor: 1024 ** 3 },
      TB: { name: 'Terabytes (TB)', factor: 1024 ** 4 },
      PB: { name: 'Petabytes (PB)', factor: 1024 ** 5 },
    },
  },
  area: {
    label: 'Area',
    base: 'sqm',
    units: {
      sqm: { name: 'Square Meters (m²)', factor: 1 },
      sqkm: { name: 'Square Kilometers (km²)', factor: 1e6 },
      sqft: { name: 'Square Feet (ft²)', factor: 0.092903 },
      sqin: { name: 'Square Inches (in²)', factor: 0.00064516 },
      ac: { name: 'Acres (ac)', factor: 4046.856 },
      ha: { name: 'Hectares (ha)', factor: 10000 },
    },
  },
  speed: {
    label: 'Speed',
    base: 'mps',
    units: {
      mps: { name: 'Meters / sec (m/s)', factor: 1 },
      kmh: { name: 'Kilometers / hour (km/h)', factor: 0.277778 },
      mph: { name: 'Miles / hour (mph)', factor: 0.44704 },
      kn: { name: 'Knots (kn)', factor: 0.514444 },
      fts: { name: 'Feet / sec (ft/s)', factor: 0.3048 },
    },
  },
  time: {
    label: 'Time',
    base: 's',
    units: {
      ms: { name: 'Milliseconds (ms)', factor: 0.001 },
      s: { name: 'Seconds (s)', factor: 1 },
      min: { name: 'Minutes (min)', factor: 60 },
      hr: { name: 'Hours (hr)', factor: 3600 },
      day: { name: 'Days (d)', factor: 86400 },
      wk: { name: 'Weeks (wk)', factor: 604800 },
      yr: { name: 'Years (yr)', factor: 31536000 },
    },
  },
  pressure: {
    label: 'Pressure',
    base: 'pa',
    units: {
      pa: { name: 'Pascals (Pa)', factor: 1 },
      kpa: { name: 'Kilopascals (kPa)', factor: 1000 },
      bar: { name: 'Bar', factor: 100000 },
      psi: { name: 'Pounds / sq inch (psi)', factor: 6894.76 },
      atm: { name: 'Standard Atmospheres (atm)', factor: 101325 },
      torr: { name: 'Torr (mmHg)', factor: 133.322 },
    },
  },
  energy: {
    label: 'Energy',
    base: 'j',
    units: {
      j: { name: 'Joules (J)', factor: 1 },
      kj: { name: 'Kilojoules (kJ)', factor: 1000 },
      cal: { name: 'Calories (cal)', factor: 4.184 },
      kcal: { name: 'Kilocalories (kcal)', factor: 4184 },
      wh: { name: 'Watt-hours (Wh)', factor: 3600 },
      kwh: { name: 'Kilowatt-hours (kWh)', factor: 3.6e6 },
      btu: { name: 'BTU', factor: 1055.06 },
    },
  },
  power: {
    label: 'Power',
    base: 'w',
    units: {
      w: { name: 'Watts (W)', factor: 1 },
      kw: { name: 'Kilowatts (kW)', factor: 1000 },
      mw: { name: 'Megawatts (MW)', factor: 1e6 },
      hp: { name: 'Horsepower (hp)', factor: 745.7 },
    },
  },
  angle: {
    label: 'Angle',
    base: 'deg',
    units: {
      deg: { name: 'Degrees (°)', factor: 1 },
      rad: { name: 'Radians (rad)', factor: 57.2958 },
      grad: { name: 'Gradians (grad)', factor: 0.9 },
      arcmin: { name: 'Arcminutes (′)', factor: 1 / 60 },
      arcsec: { name: 'Arcseconds (″)', factor: 1 / 3600 },
    },
  },
}

function convertUnits(val, fromKey, toKey, categoryKey) {
  if (val === '' || isNaN(Number(val))) return ''
  const num = Number(val)
  const cat = UNIT_CATEGORIES[categoryKey]
  if (!cat) return ''

  if (categoryKey === 'temperature') {
    let celsius = num
    if (fromKey === 'f') celsius = ((num - 32) * 5) / 9
    else if (fromKey === 'k') celsius = num - 273.15

    if (toKey === 'c') return parseFloat(celsius.toFixed(4))
    if (toKey === 'f') return parseFloat(((celsius * 9) / 5 + 32).toFixed(4))
    if (toKey === 'k') return parseFloat((celsius + 273.15).toFixed(4))
    return num
  }

  const fromFactor = cat.units[fromKey]?.factor || 1
  const toFactor = cat.units[toKey]?.factor || 1
  const baseVal = num * fromFactor
  const targetVal = baseVal / toFactor

  if (Math.abs(targetVal) < 0.0001 && targetVal !== 0) {
    return targetVal.toExponential(4)
  }
  return parseFloat(targetVal.toFixed(6))
}

export default function UnitConverterTool() {
  const { toast } = useApp()
  const [category, setCategory] = useState('length')
  const [fromUnit, setFromUnit] = useState('m')
  const [toUnit, setToUnit] = useState('ft')
  const [inputValue, setInputValue] = useState('10')

  const currentCat = UNIT_CATEGORIES[category]

  // Switch category and reset unit keys
  const handleCategoryChange = (newCat) => {
    setCategory(newCat)
    const unitKeys = Object.keys(UNIT_CATEGORIES[newCat].units)
    setFromUnit(unitKeys[0])
    setToUnit(unitKeys[1] || unitKeys[0])
  }

  // Swap From and To units
  const handleSwap = () => {
    const temp = fromUnit
    setFromUnit(toUnit)
    setToUnit(temp)
  }

  // Calculate output value
  const convertedValue = useMemo(() => {
    return convertUnits(inputValue, fromUnit, toUnit, category)
  }, [inputValue, fromUnit, toUnit, category])

  // Equivalents across all units in this category
  const allEquivalents = useMemo(() => {
    if (!inputValue || isNaN(Number(inputValue))) return []
    return Object.entries(currentCat.units).map(([key, info]) => {
      const res = convertUnits(inputValue, fromUnit, key, category)
      return { key, name: info.name, value: res }
    })
  }, [inputValue, fromUnit, category, currentCat])

  return (
    <div className="fc-tool-workspace">
      {/* Category Tabs */}
      <div className="fc-cat-tabs mb-6">
        {Object.entries(UNIT_CATEGORIES).map(([catKey, catData]) => (
          <button
            key={catKey}
            type="button"
            className={`fc-cat-tab${category === catKey ? ' is-active' : ''}`}
            onClick={() => handleCategoryChange(catKey)}
          >
            {catData.label}
          </button>
        ))}
      </div>

      <div className="fc-tool-grid">
        {/* Left: Input & Conversion Card */}
        <div className="fc-tool-panel">
          <div className="flex items-center justify-between mb-2">
            <h3 className="fc-panel-title">Convert {currentCat.label}</h3>
            <span className="fc-file-format-badge">64-BIT PRECISION</span>
          </div>

          <div className="flex flex-col gap-4">
            {/* Input Row */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[var(--fc-text-dim)] uppercase tracking-wider">From</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  className="fc-input font-mono flex-1 text-base font-semibold"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Enter value…"
                />
                <select
                  className="fc-select w-44"
                  value={fromUnit}
                  onChange={(e) => setFromUnit(e.target.value)}
                >
                  {Object.entries(currentCat.units).map(([k, u]) => (
                    <option key={k} value={k}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Swap Button */}
            <div className="flex justify-center my-1">
              <button
                type="button"
                className="fc-btn fc-btn-secondary h-8 px-3 text-xs"
                onClick={handleSwap}
                title="Swap units"
              >
                <Icon name="convert" size={14} />
                <span>Swap</span>
              </button>
            </div>

            {/* Output Row */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[var(--fc-text-dim)] uppercase tracking-wider">To</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  className="fc-input font-mono flex-1 text-base font-semibold bg-[var(--fc-surface-2)] text-[var(--fc-accent)]"
                  value={convertedValue !== '' ? convertedValue : '—'}
                />
                <select
                  className="fc-select w-44"
                  value={toUnit}
                  onChange={(e) => setToUnit(e.target.value)}
                >
                  {Object.entries(currentCat.units).map(([k, u]) => (
                    <option key={k} value={k}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Formula / Result Card */}
            <div className="p-3.5 rounded-xl bg-[var(--fc-accent-wash)] border border-[var(--fc-accent-soft)] text-xs flex items-center justify-between">
              <span className="text-[var(--fc-text-dim)]">
                {inputValue || 0} {currentCat.units[fromUnit]?.name} =
              </span>
              <span className="font-mono font-bold text-[var(--fc-accent)] text-sm">
                {convertedValue || 0} {currentCat.units[toUnit]?.name}
              </span>
            </div>

            <button
              type="button"
              className="fc-btn fc-btn-secondary w-full"
              onClick={() => {
                navigator.clipboard.writeText(`${convertedValue}`)
                toast('Result copied to clipboard!', 'good')
              }}
            >
              <Icon name="copy" size={14} />
              <span>Copy Converted Value</span>
            </button>
          </div>
        </div>

        {/* Right: Comprehensive Equivalents Table */}
        <div className="fc-tool-panel">
          <div className="fc-panel-title mb-1">All {currentCat.label} Equivalents</div>
          <p className="fc-panel-desc mb-3">
            Quick reference for {inputValue || 0} {currentCat.units[fromUnit]?.name} across all units.
          </p>

          <div className="flex flex-col gap-1.5 max-h-96 overflow-y-auto pr-1">
            {allEquivalents.map((item) => (
              <div
                key={item.key}
                className={`flex items-center justify-between p-2.5 px-3 rounded-lg border text-xs cursor-pointer transition ${
                  item.key === toUnit
                    ? 'bg-[var(--fc-accent-wash)] border-[var(--fc-accent-soft)] text-[var(--fc-accent)] font-semibold shadow-xs'
                    : 'bg-[var(--fc-surface-2)] border-[var(--fc-border)] text-[var(--fc-text)] hover:bg-[var(--fc-surface-hover)]'
                }`}
                onClick={() => setToUnit(item.key)}
              >
                <span className="font-medium truncate max-w-[180px]">{item.name}</span>
                <span className="font-mono font-semibold text-right truncate max-w-[140px]">
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
