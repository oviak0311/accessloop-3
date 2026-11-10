// Map setup shared by the home map and the small map on each barrier page.
// Leaflet (public/vendor/leaflet) is loaded on the page before this module as the global `L`.
import { esc, barrierIcon } from './ui.js';

export const TORONTO = [43.7, -79.4];

export const hasCoords = (location) => location.latitude != null && location.longitude != null;
export const latLng = (location) => [location.latitude, location.longitude];

// Where the map images (tiles) come from. Kept in one place so it's easy to switch.
// OpenStreetMap's own tiles need no key. Their usage policy asks for visible attribution
// and light use: https://operations.osmfoundation.org/policies/tiles/
// styles.css softens their colours so the coloured pins stand out.
// To use CARTO's light style instead, request a free non-commercial key at
// https://carto.com/basemaps/apikey and use:
//   url: 'https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key=YOUR_KEY'
const TILES = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

export function createBaseMap(elementId, options = {}) {
  const map = L.map(elementId, { minZoom: 10, maxZoom: 18, ...options });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  L.tileLayer(TILES.url, { maxZoom: 19, attribution: TILES.attribution }).addTo(map);
  return map;
}

// The design's teardrop pin. The tip (bottom centre) sits on the stop's location.
export function pinIcon(category, { count = 1, label = '', closed = false } = {}) {
  return L.divIcon({
    className: `al-marker${closed ? ' is-closed' : ''}`,
    html: `<span class="map-pin">${barrierIcon(category, { size: 22, count })}<span class="pin-label">${esc(label)}</span></span>`,
    iconSize: [46, 52],
    iconAnchor: [23, 51],
  });
}
