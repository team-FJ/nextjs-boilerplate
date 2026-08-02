"use client";

import { V_H, V_W } from "@/lib/versus/constants";
import { COURSE_IDS, COURSES, getCourse, wallsFor, zonesFor } from "@/lib/versus/courses";
import type { CourseId } from "@/lib/versus/types";

/** 選んだコースの形が一目で分かるように、縮小した図を出す */
function CoursePreview({ id }: { id: CourseId }) {
  const course = getCourse(id);
  const zones = zonesFor(course);
  const walls = wallsFor(course);
  return (
    <svg
      viewBox={`0 0 ${V_W} ${V_H}`}
      className="h-[92px] w-[62px] shrink-0 rounded border border-white/15 bg-black/40"
      aria-hidden
    >
      <rect x={0} y={zones.top.top} width={V_W} height={zones.top.bottom - zones.top.top} fill="#3a1020" />
      <rect x={0} y={zones.band.top} width={V_W} height={zones.band.bottom - zones.band.top} fill="#1a1a2c" />
      <rect
        x={0}
        y={zones.bottom.top}
        width={V_W}
        height={zones.bottom.bottom - zones.bottom.top}
        fill="#0a1c34"
      />
      {walls.map((w, i) => (
        <rect key={i} x={w.x - w.w / 2} y={w.y - w.h / 2} width={w.w} height={w.h} fill="#8fa3c8" />
      ))}
    </svg>
  );
}

/**
 * 対戦コースの選択。13種あるので横並びではなく折り返しの一覧にして、
 * 選んだものだけ図と説明を出す。
 */
export function CourseSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: CourseId;
  onChange: (id: CourseId) => void;
  disabled?: boolean;
}) {
  const current = getCourse(value);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <CoursePreview id={value} />
        <div className="min-w-0 pt-0.5">
          <div className="text-sm font-bold text-white">{current.name}</div>
          <div className="mt-0.5 font-mono text-[10px] leading-relaxed text-white/50">{current.desc}</div>
          <div className="mt-1 font-mono text-[9px] text-white/35">
            陣地 {current.zoneH}px ・ 壁 {wallsFor(current).length}枚 ・ 敵 x{current.enemyRate}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {COURSE_IDS.map((id) => (
          <button
            key={id}
            disabled={disabled}
            onClick={() => onChange(id)}
            className={`rounded border px-2 py-1 font-mono text-[10px] transition-colors ${
              id === value
                ? "border-cyan-300/70 bg-cyan-400/25 text-cyan-100"
                : disabled
                  ? "border-white/10 bg-white/[0.02] text-white/25"
                  : "border-white/15 bg-white/5 text-white/60 hover:border-cyan-300/50 hover:bg-cyan-400/10"
            }`}
          >
            {COURSES[id].name}
          </button>
        ))}
      </div>
    </div>
  );
}
