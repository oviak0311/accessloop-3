// Barrier pins on a map: one pin per stop, and pins that would overlap at the current zoom
// merge into a numbered bubble that zooms in when pressed. Used by the home map and Explore.
import { pinIcon, hasCoords, latLng } from './mapbase.js';
import { byUrgency, esc } from './ui.js';

const CLUSTER_RADIUS = 58; // px
const SPREAD_ZOOM = 16; // from this zoom in, every stop gets its own pin
const LABEL_ZOOM = 15; // pin labels show from this zoom in
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createPinLayer(map, { onPick, labelsClassTarget }) {
  const layer = L.layerGroup().addTo(map);
  let places = new Map(); // locationId -> { location, reports }
  let pins = []; // { marker, locationIds }
  let activeLocationId = null;
  let highlighted = null; // Set of locationIds kept bright while a route is shown; others fade

  function setReports(reports) {
    places = new Map();
    for (const report of reports) {
      if (!hasCoords(report.location)) continue;
      const id = report.location.id;
      if (!places.has(id)) places.set(id, { location: report.location, reports: [] });
      places.get(id).reports.push(report);
    }
    for (const place of places.values()) place.reports.sort(byOpenThenUrgency);
    render();
  }

  function byOpenThenUrgency(a, b) {
    return Number(b.isOpen) - Number(a.isOpen) || byUrgency(a, b);
  }

  function render() {
    layer.clearLayers();
    pins = [];
    const zoom = map.getZoom();
    labelsClassTarget?.classList.toggle('show-labels', zoom >= LABEL_ZOOM);

    const groups = [];
    for (const place of places.values()) {
      const point = map.latLngToLayerPoint(latLng(place.location));
      const radius = zoom >= SPREAD_ZOOM ? 12 : CLUSTER_RADIUS;
      const near = groups.find((g) => g.point.distanceTo(point) < radius);
      if (near) near.places.push(place);
      else groups.push({ point, places: [place] });
    }
    for (const { places: group } of groups) {
      if (group.length === 1 || zoom >= SPREAD_ZOOM) addPin(group);
      else addCluster(group);
    }
    decorate();
  }

  function addPin(group) {
    const reports = group.flatMap((p) => p.reports).sort(byOpenThenUrgency);
    const top = reports[0];
    const closed = reports.every((r) => !r.isOpen);
    const marker = L.marker(latLng(group[0].location), {
      icon: pinIcon(top.category, { count: reports.length, label: top.category.name, closed }),
      keyboard: true,
      riseOnHover: true,
    });
    marker.on('click', () => onPick(reports, marker.getElement()));
    marker.addTo(layer);
    const where = group.length === 1 ? group[0].location.label : group[0].location.name;
    const extra = reports.length > 1 ? `. ${reports.length} reports here` : closed ? '. Closed' : '';
    marker.getElement().setAttribute('aria-label', `${top.category.name} at ${where}${extra}`);
    pins.push({ marker, locationIds: group.map((p) => p.location.id), cluster: false });
  }

  function addCluster(group) {
    const bounds = L.latLngBounds(group.map((p) => latLng(p.location)));
    const total = group.reduce((n, p) => n + p.reports.length, 0);
    const marker = L.marker(bounds.getCenter(), {
      icon: L.divIcon({ className: 'al-marker', html: `<span class="map-cluster"><b>${total}</b></span>`, iconSize: [48, 48], iconAnchor: [24, 24] }),
      keyboard: true,
    });
    marker.on('click', () => map.fitBounds(bounds, { padding: [90, 90], maxZoom: SPREAD_ZOOM, animate: !reduceMotion }));
    marker.addTo(layer);
    marker.getElement().setAttribute('aria-label', esc(`${total} reports at ${group.length} stops. Zoom in to see them`));
    pins.push({ marker, locationIds: group.map((p) => p.location.id), cluster: true });
  }

  function decorate() {
    for (const { marker, locationIds } of pins) {
      const el = marker.getElement();
      if (!el) continue;
      el.classList.toggle('is-active', activeLocationId !== null && locationIds.includes(activeLocationId));
      el.classList.toggle('is-muted', Boolean(highlighted) && !locationIds.some((id) => highlighted.has(id)));
    }
  }

  map.on('zoomend', render);

  return {
    setReports,
    render,
    places: () => places,
    // True when a stop's pin is merged into a numbered bubble at the current zoom.
    isClustered: (locationId) => pins.some((p) => p.cluster && p.locationIds.includes(locationId)),
    SPREAD_ZOOM,
    setActive(locationId) {
      activeLocationId = locationId;
      decorate();
    },
    setHighlighted(locationIds) {
      highlighted = locationIds ? new Set(locationIds) : null;
      decorate();
    },
  };
}
