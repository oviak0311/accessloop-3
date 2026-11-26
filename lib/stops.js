// Small helpers for matching and sorting stations and stops.
// Used by the API (routes/api.js) and the stop import (prisma/import-stops.js).
import { LOCATION_TYPE_LABELS } from './rules.js';

// Straight-line distance between two points, in kilometres.
export function distanceKm(lat1, lng1, lat2, lng2) {
  const rad = (d) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// A name reduced to plain words, so "Kennedy Station" and "kennedy" count as the same stop,
// and so do "Bloor–Yonge" and "Bloor-Yonge".
export const stopKey = (name) =>
  String(name).toLowerCase().replace(/\bstation\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export const STATION_TYPES = ['SUBWAY_STATION', 'LRT_STATION', 'GO_STATION'];
export const isStation = (location) => STATION_TYPES.includes(location.type);

// A "whole" stop is the stop itself, not one part of it like an elevator. Its spot is just its
// type ("Bus stop"), so its label is just its name.
export const isWhole = (location) => location.spot === LOCATION_TYPE_LABELS[location.type];

// Search results, best first: a stop whose number is what was typed, then a name that is
// exactly what was typed (a station, then a stop, then a part of one, like its elevator), then
// other stations, then names that start with what was typed, then everything else in the order
// it came in (A to Z).
export function rankStops(list, q) {
  const typed = stopKey(q);
  const score = (l) => {
    const key = stopKey(l.name);
    if (l.code && l.code === String(q).trim()) return 0;
    if (key === typed) return !isWhole(l) ? 3 : isStation(l) ? 1 : 2;
    if (isStation(l)) return 4;
    return key.startsWith(typed) ? 5 : 6;
  };
  return list
    .map((l, i) => ({ l, i, s: score(l) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map(({ l }) => l);
}
