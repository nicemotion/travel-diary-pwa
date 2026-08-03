// geolocation.js — sostituisce location.py. Usa l'API nativa del browser
// (navigator.geolocation), che su telefono usa il GPS vero, su PC di solito
// una stima via wifi/IP (meno precisa, va bene solo per test).

export function getLocation() {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}
