// Small map maths used to find barriers along a planned route.

const EARTH_M = 6371000;
const rad = (d) => (d * Math.PI) / 180;

// Straight-line distance in metres between two points.
export function distanceM(a, b) {
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

// Decodes a Google-encoded polyline into [[lat, lng], ...].
export function decodePolyline(points, precision = 6) {
  const factor = 10 ** precision;
  const coords = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < points.length) {
    for (const axis of [0, 1]) {
      let result = 0;
      let shift = 0;
      let byte;
      do {
        byte = points.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    coords.push([lat / factor, lng / factor]);
  }
  return coords;
}

// Shortest distance in metres from a point to a line of [lat, lng] points.
// Flat-map maths is accurate enough over the few kilometres of a city walk.
export function distanceToLineM(point, line) {
  if (!line.length) return Infinity;
  if (line.length === 1) return distanceM(point, { lat: line[0][0], lng: line[0][1] });
  const mPerLat = (Math.PI * EARTH_M) / 180;
  const mPerLng = mPerLat * Math.cos(rad(point.lat));
  const toXY = ([lat, lng]) => [(lng - point.lng) * mPerLng, (lat - point.lat) * mPerLat];
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i += 1) {
    const [ax, ay] = toXY(line[i]);
    const [bx, by] = toXY(line[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
