"use client";

import {
  MapContainer,
  TileLayer,
  Rectangle,
  Polygon,
  Polyline,
  Marker,
} from "react-leaflet";
import L from "leaflet";
import type { LatLngBoundsExpression, PathOptions } from "leaflet";
import "leaflet/dist/leaflet.css";
import { AREA, SEARCH_ZONE, CELL_MASK, TRAILS } from "@/lib/searchZone";

export type CellState = "unsearched" | "clear";

export interface InjuryPin {
  id: string;
  lat: number;
  lng: number;
  gridX: number;
  gridY: number;
  count: number;
  timestamp: number;
}

interface Props {
  grid: CellState[][];
  robotPos: { x: number; y: number };
  robotDir: "n" | "s" | "e" | "w";
  rows: number;
  cols: number;
  injuries: InjuryPin[];
  onPinClick?: (id: string) => void;
}

const CELL_STYLE: Record<CellState, PathOptions> = {
  unsearched: {
    color: "#ef4444",
    fillColor: "#ef4444",
    fillOpacity: 0.18,
    weight: 0.5,
    opacity: 0.2,
  },
  clear: {
    color: "transparent",
    fillColor: "#22c55e",
    fillOpacity: 0.22,
    weight: 0,
  },
};

const DIR_ROTATION = { n: 0, e: 90, s: 180, w: 270 } as const;

function makeRobotIcon(dir: "n" | "s" | "e" | "w") {
  const rot = DIR_ROTATION[dir];
  return L.divIcon({
    className: "",
    html: `<div style="
      width:44px;height:44px;position:relative;
      transform:rotate(${rot}deg);
    ">
      <div style="
        position:absolute;inset:4px;border-radius:50%;
        background:radial-gradient(circle,rgba(34,211,238,0.35) 0%,transparent 70%);
        animation:pulse-glow 1.5s ease-in-out infinite;
      "></div>
      <div style="
        position:absolute;top:50%;left:50%;
        transform:translate(-50%,-50%);
        width:18px;height:18px;
        background:#22d3ee;border:2.5px solid #fff;border-radius:50%;
        box-shadow:0 0 16px rgba(34,211,238,0.8);
      "></div>
      <div style="
        position:absolute;top:3px;left:50%;
        transform:translateX(-50%);
        width:0;height:0;
        border-left:7px solid transparent;
        border-right:7px solid transparent;
        border-bottom:12px solid #22d3ee;
        filter:drop-shadow(0 0 4px rgba(34,211,238,0.6));
      "></div>
    </div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

const injuryIcon = L.divIcon({
  className: "",
  html: `<div style="
    width:28px;height:28px;
    background:radial-gradient(circle,#ef4444 40%,transparent 70%);
    border:2px solid #fca5a5;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    font-size:14px;color:white;
    box-shadow:0 0 12px rgba(239,68,68,0.7);
    cursor:pointer;
  ">⚠</div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

export default function SearchMap({
  grid,
  robotPos,
  robotDir,
  rows,
  cols,
  injuries,
  onPinClick,
}: Props) {
  const cellW = (AREA.east - AREA.west) / cols;
  const cellH = (AREA.north - AREA.south) / rows;

  const center: [number, number] = [
    (AREA.north + AREA.south) / 2 - 4.5 * cellH,
    (AREA.east + AREA.west) / 2,
  ];

  const robotLatLng: [number, number] = [
    AREA.north - (robotPos.y + 0.5) * cellH,
    AREA.west + (robotPos.x + 0.5) * cellW,
  ];

  const robotIcon = makeRobotIcon(robotDir);

  return (
    <MapContainer
      center={center}
      zoom={19}
      style={{ height: "100%", width: "100%" }}
      zoomControl={false}
      attributionControl={false}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        maxZoom={20}
      />

      {/* Trail / fire-road paths */}
      {TRAILS.map((trail, i) => (
        <Polyline
          key={`trail-${i}`}
          positions={trail}
          pathOptions={{
            color: "#fbbf24",
            weight: 2,
            opacity: 0.5,
            dashArray: "6 4",
          }}
        />
      ))}

      {/* Search zone perimeter — solid line */}
      <Polygon
        positions={SEARCH_ZONE}
        pathOptions={{
          color: "#f97316",
          weight: 2.5,
          fill: false,
          opacity: 0.85,
        }}
      />

      {/* Grid cells (only inside polygon) */}
      {grid.flatMap((row, y) =>
        row.map((cell, x) => {
          if (!CELL_MASK[y]?.[x]) return null;
          const bounds: LatLngBoundsExpression = [
            [AREA.north - (y + 1) * cellH, AREA.west + x * cellW],
            [AREA.north - y * cellH, AREA.west + (x + 1) * cellW],
          ];
          return (
            <Rectangle
              key={`${x}-${y}`}
              bounds={bounds}
              pathOptions={CELL_STYLE[cell]}
            />
          );
        }),
      )}

      {/* Injury pins */}
      {injuries.map((pin) => (
        <Marker
          key={pin.id}
          position={[pin.lat, pin.lng]}
          icon={injuryIcon}
          eventHandlers={{ click: () => onPinClick?.(pin.id) }}
        />
      ))}

      {/* Robot marker with direction arrow */}
      <Marker
        position={robotLatLng}
        icon={robotIcon}
        zIndexOffset={1000}
      />
    </MapContainer>
  );
}
