import type { PlannerEvent } from '../domain/planner'

// Events are ordered by start time, then end time.
export function placeTimelineEvents(
  events: readonly PlannerEvent[],
  offsetAt: (minute: number) => number,
  timelineEnd: number,
) {
  type Position = { event: PlannerEvent; top: number; height: number; lane: number }
  const tiles: { event: PlannerEvent; style: Record<string, string> }[] = []
  let group: Position[] = []
  let laneEnds: number[] = []
  let groupEnd = 0

  function finishGroup() {
    const width = 100 / laneEnds.length
    for (const { event, top, height, lane } of group) {
      tiles.push({
        event,
        style: {
          top: `${top}px`,
          height: `${height}px`,
          left: `calc(${lane * width}% + 1px)`,
          width: `max(1px, calc(${width}% - 2px))`,
        },
      })
    }
    group = []
    laneEnds = []
    groupEnd = 0
  }

  for (const event of events) {
    const height = Math.max(16, offsetAt(event.end) - offsetAt(event.start) - 2)
    const top = Math.min(offsetAt(event.start) + 1, timelineEnd - height)
    if (group.length && top >= groupEnd) {
      finishGroup()
    }
    const available = laneEnds.findIndex((end) => end <= top)
    const lane = available === -1 ? laneEnds.length : available
    const bottom = top + height
    laneEnds[lane] = bottom
    groupEnd = Math.max(groupEnd, bottom)
    group.push({ event, top, height, lane })
  }
  if (group.length) {
    finishGroup()
  }
  return tiles
}
