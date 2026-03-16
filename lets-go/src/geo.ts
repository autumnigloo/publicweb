export interface LatLon {
  lat: number;
  lon: number;
}

export interface MeterVector {
  east: number;
  north: number;
}

const EARTH_RADIUS_METERS = 6371000;

export function deltaMeters(from: LatLon, to: LatLon): MeterVector {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const meanLat = (lat1 + lat2) * 0.5;

  return {
    north: dLat * EARTH_RADIUS_METERS,
    east: dLon * EARTH_RADIUS_METERS * Math.cos(meanLat),
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function toBoardOffset(
  delta: MeterVector,
  metersPerCell: number,
  halfWidth: number,
  halfHeight: number
) {
  const x = clamp(Math.round(delta.east / metersPerCell), -halfWidth, halfWidth);
  const y = clamp(Math.round(-delta.north / metersPerCell), -halfHeight, halfHeight);
  return { x, y };
}

export function formatMeters(value: number): string {
  const abs = Math.abs(value);
  if (abs < 10) {
    return `${value.toFixed(1)} m`;
  }
  return `${Math.round(value)} m`;
}
