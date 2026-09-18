export function validCoordinates({ latitude, longitude } = {}) {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
}

export function deviceLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Device location is unavailable here. Search for a city or enter a location.'))
    navigator.geolocation.getCurrentPosition(position => {
      const { latitude, longitude } = position.coords
      if (!validCoordinates({ latitude, longitude })) return reject(new Error('The device returned an invalid location. Enter a location instead.'))
      resolve({ latitude, longitude })
    }, error => reject(new Error(error.code === 1
      ? 'Location access was denied. Search for a city or enter a location.'
      : 'Could not locate this device. Search for a city or enter a location.')),
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 })
  })
}
