/**
 * 経路を GPX にする。スマホの地図アプリや GPS 機器に持ち出せるようにするため。
 */

import type { RoutePoint } from "./search";

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&apos;",
  );
}

export function toGpx(points: RoutePoint[], name: string): string {
  const pts = points
    .map((p) => {
      const ele = Number.isNaN(p.ele) ? "" : `<ele>${p.ele.toFixed(1)}</ele>`;
      return `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${ele}</trkpt>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="disaster-route" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(name)}</name></metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}
