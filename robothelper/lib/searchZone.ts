export const ROWS = 14;
export const COLS = 14;

// Property lot bounded by West Sunset Blvd (S), El Medio Ave (E),
// and lot boundaries (N/W) — Pacific Palisades
export const AREA = {
  north: 34.04940,
  south: 34.04850,
  west: -118.53440,
  east: -118.53325,
};

// Road center-lines drawn as polylines
export const TRAILS: [number, number][][] = [
  // West Sunset Boulevard
  [
    [34.04870, -118.53445],
    [34.04869, -118.53420],
    [34.04868, -118.53400],
    [34.04867, -118.53380],
    [34.04866, -118.53360],
    [34.04866, -118.53340],
    [34.04867, -118.53320],
  ],
  // El Medio Avenue
  [
    [34.04866, -118.53340],
    [34.04885, -118.53341],
    [34.04905, -118.53342],
    [34.04925, -118.53344],
    [34.04945, -118.53346],
  ],
  // Internal driveway
  [
    [34.04868, -118.53410],
    [34.04885, -118.53400],
    [34.04900, -118.53395],
    [34.04915, -118.53392],
  ],
];

// 6-vertex perimeter aligned to the actual CartoDB tile roads:
//   1→2  S:  West Sunset Blvd
//   2→3  SE: lower El Medio Ave
//   3→4  E:  upper El Medio Ave
//   4→5  N:  back property line
//   5→6  NW: lot boundary diagonal
//   6→1  W:  western lot line
export const SEARCH_ZONE: [number, number][] = [
  [34.04868, -118.53430], // 1 SW — Sunset Blvd at west lot line
  [34.04866, -118.53340], // 2 SE — Sunset / El Medio intersection
  [34.04905, -118.53342], // 3 E  — El Medio midway
  [34.04935, -118.53345], // 4 NE — El Medio north / property corner
  [34.04935, -118.53395], // 5 N  — back property line
  [34.04915, -118.53430], // 6 NW — lot boundary meets west edge
];

// Cells pre-cleared for demo (robot searched along the driveway)
export const DEMO_CLEARED: [number, number][] = [
  [4, 11], [4, 10], [5, 10],
  [5, 9], [5, 8], [5, 7],
  [5, 6], [6, 6], [6, 5], [6, 4],
];

function pointInPolygon(
  lat: number,
  lng: number,
  poly: [number, number][],
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

const cellW = (AREA.east - AREA.west) / COLS;
const cellH = (AREA.north - AREA.south) / ROWS;

export const CELL_MASK: boolean[][] = Array.from({ length: ROWS }, (_, y) =>
  Array.from({ length: COLS }, (_, x) => {
    const lat = AREA.north - (y + 0.5) * cellH;
    const lng = AREA.west + (x + 0.5) * cellW;
    return pointInPolygon(lat, lng, SEARCH_ZONE);
  }),
);

export const ACTIVE_CELLS = CELL_MASK.flat().filter(Boolean).length;
