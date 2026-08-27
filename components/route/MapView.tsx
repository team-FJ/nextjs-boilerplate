"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import type { BBox, LatLng } from "@/lib/route/geo";
import { BASE_LAYERS, HAZARD_LAYERS, OSM_ATTRIBUTION } from "@/lib/route/tiles";

export interface MapViewProps {
  start: LatLng | null;
  goal: LatLng | null;
  onPick: (p: LatLng) => void;
  onMoveStart: (p: LatLng) => void;
  onMoveGoal: (p: LatLng) => void;
  safeLine: LatLng[] | null;
  shortestLine: LatLng[] | null;
  fallbackLine: LatLng[] | null;
  fallbackPoint: LatLng | null;
  /** 断面図をなぞっているときの現在地。 */
  hover: LatLng | null;
  baseLayerId: string;
  overlayIds: string[];
  overlayOpacity: number;
  showShortest: boolean;
  /** 新しいオブジェクトが渡されたら、その範囲に合わせる。 */
  fitBounds: BBox | null;
}

const START_ICON = L.divIcon({
  className: "",
  html: `<div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#0f766e;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.5);color:#fff;font:700 12px/1 sans-serif">出</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const GOAL_ICON = L.divIcon({
  className: "",
  html: `<div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#b91c1c;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.5);color:#fff;font:700 12px/1 sans-serif">着</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const REFUGE_ICON = L.divIcon({
  className: "",
  html: `<div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#a16207;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.5);color:#fff;font:700 11px/1 sans-serif">高</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

function toLatLngs(points: LatLng[]): L.LatLngExpression[] {
  return points.map((p) => [p.lat, p.lon]);
}

export default function MapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseRef = useRef<L.TileLayer | null>(null);
  const overlayRef = useRef<Map<string, L.TileLayer>>(new Map());
  const startRef = useRef<L.Marker | null>(null);
  const goalRef = useRef<L.Marker | null>(null);
  const refugeRef = useRef<L.Marker | null>(null);
  const safeRef = useRef<L.Polyline | null>(null);
  const safeCaseRef = useRef<L.Polyline | null>(null);
  const shortRef = useRef<L.Polyline | null>(null);
  const fallbackRef = useRef<L.Polyline | null>(null);
  const hoverRef = useRef<L.CircleMarker | null>(null);

  // クリック・ドラッグのハンドラは毎回変わるので、最新のものを ref 越しに呼ぶ。
  // （Leaflet 側のリスナーを張り直さずに済ませるため）
  const handlers = useRef(props);
  useEffect(() => {
    handlers.current = props;
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [35.6586, 139.7454],
      zoom: 14,
      zoomControl: true,
      attributionControl: true,
    });
    map.attributionControl.addAttribution(OSM_ATTRIBUTION);
    L.control.scale({ imperial: false }).addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => {
      handlers.current.onPick({ lat: e.latlng.lat, lon: e.latlng.lng });
    });
    mapRef.current = map;
    // 折りたたみの開閉などでサイズが変わったときに描画を追従させる。
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 背景地図
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const def = BASE_LAYERS.find((l) => l.id === props.baseLayerId) ?? BASE_LAYERS[0];
    baseRef.current?.remove();
    baseRef.current = L.tileLayer(def.url, {
      attribution: def.attribution,
      maxZoom: def.maxZoom,
      maxNativeZoom: def.maxNativeZoom,
    }).addTo(map);
    baseRef.current.bringToBack();
  }, [props.baseLayerId]);

  // ハザードマップの重ね合わせ
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const active = new Set(props.overlayIds);
    for (const [id, layer] of overlayRef.current) {
      if (!active.has(id)) {
        layer.remove();
        overlayRef.current.delete(id);
      } else {
        layer.setOpacity(props.overlayOpacity);
      }
    }
    for (const id of active) {
      if (overlayRef.current.has(id)) continue;
      const def = HAZARD_LAYERS.find((l) => l.id === id);
      if (!def) continue;
      const layer = L.tileLayer(def.url, {
        attribution: def.attribution,
        maxZoom: def.maxZoom,
        maxNativeZoom: def.maxNativeZoom,
        opacity: props.overlayOpacity,
      }).addTo(map);
      overlayRef.current.set(id, layer);
    }
  }, [props.overlayIds, props.overlayOpacity]);

  // 出発地・目的地
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    startRef.current = syncMarker(
      map,
      startRef.current,
      props.start,
      START_ICON,
      (p) => handlers.current.onMoveStart(p),
    );
  }, [props.start]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    goalRef.current = syncMarker(
      map,
      goalRef.current,
      props.goal,
      GOAL_ICON,
      (p) => handlers.current.onMoveGoal(p),
    );
  }, [props.goal]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    refugeRef.current = syncMarker(
      map,
      refugeRef.current,
      props.fallbackPoint,
      REFUGE_ICON,
    );
  }, [props.fallbackPoint]);

  // 経路の描画
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    shortRef.current?.remove();
    shortRef.current = null;
    if (props.shortestLine && props.showShortest) {
      shortRef.current = L.polyline(toLatLngs(props.shortestLine), {
        color: "#64748b",
        weight: 4,
        opacity: 0.85,
        dashArray: "6 8",
      }).addTo(map);
    }
  }, [props.shortestLine, props.showShortest]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    safeCaseRef.current?.remove();
    safeRef.current?.remove();
    safeCaseRef.current = null;
    safeRef.current = null;
    if (props.safeLine) {
      const latlngs = toLatLngs(props.safeLine);
      // 太い白の縁取りを下に敷くと、どの背景地図でも線が見える。
      safeCaseRef.current = L.polyline(latlngs, {
        color: "#ffffff",
        weight: 11,
        opacity: 0.9,
      }).addTo(map);
      safeRef.current = L.polyline(latlngs, {
        color: "#0d9488",
        weight: 6,
        opacity: 1,
      }).addTo(map);
    }
  }, [props.safeLine]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    fallbackRef.current?.remove();
    fallbackRef.current = null;
    if (props.fallbackLine) {
      fallbackRef.current = L.polyline(toLatLngs(props.fallbackLine), {
        color: "#a16207",
        weight: 6,
        opacity: 0.95,
      }).addTo(map);
    }
  }, [props.fallbackLine]);

  // 断面図をなぞっている位置
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!props.hover) {
      hoverRef.current?.remove();
      hoverRef.current = null;
      return;
    }
    const pos: L.LatLngExpression = [props.hover.lat, props.hover.lon];
    if (hoverRef.current) hoverRef.current.setLatLng(pos);
    else
      hoverRef.current = L.circleMarker(pos, {
        radius: 7,
        color: "#ffffff",
        weight: 3,
        fillColor: "#f59e0b",
        fillOpacity: 1,
      }).addTo(map);
  }, [props.hover]);

  // 探索が終わったら結果全体が見えるように合わせる
  useEffect(() => {
    const map = mapRef.current;
    const b = props.fitBounds;
    if (!map || !b) return;
    map.fitBounds(
      L.latLngBounds([b.south, b.west], [b.north, b.east]),
      { padding: [40, 40] },
    );
  }, [props.fitBounds]);

  return <div ref={containerRef} className="h-full w-full" />;
}

function syncMarker(
  map: L.Map,
  marker: L.Marker | null,
  point: LatLng | null,
  icon: L.DivIcon,
  onMove?: (p: LatLng) => void,
): L.Marker | null {
  if (!point) {
    marker?.remove();
    return null;
  }
  if (marker) {
    marker.setLatLng([point.lat, point.lon]);
    return marker;
  }
  const created = L.marker([point.lat, point.lon], {
    icon,
    draggable: !!onMove,
    autoPan: true,
  }).addTo(map);
  if (onMove) {
    created.on("dragend", () => {
      const ll = created.getLatLng();
      onMove({ lat: ll.lat, lon: ll.lng });
    });
  }
  return created;
}
