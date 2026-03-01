import { differenceInSeconds } from "date-fns";

export function computeMetrics(
  events: any[],
  workers: any[],
  workstations: any[],
) {
  const workerMetrics: Record<string, any> = {};

  // Initialize workers
  workers.forEach((w) => {
    workerMetrics[w.worker_id] = {
      name: w.name,
      active_time: 0,
      idle_time: 0,
      units: 0,
    };
  });

  // Group events by worker
  const eventsByWorker: Record<string, any[]> = {};
  events.forEach((e) => {
    if (!eventsByWorker[e.worker_id]) eventsByWorker[e.worker_id] = [];
    eventsByWorker[e.worker_id].push(e);
  });

  // Calculate durations (assuming events are sorted by timestamp ascending)
  // product_count events are instantaneous - skip them for duration calc
  Object.keys(eventsByWorker).forEach((workerId) => {
    const wEvents = eventsByWorker[workerId];

    // Count units from product_count events
    wEvents
      .filter((e) => e.event_type === "product_count")
      .forEach((e) => {
        if (workerMetrics[workerId]) {
          workerMetrics[workerId].units += e.count || 0;
        }
      });

    // Use only state-change events (working / idle) for duration calculation
    const stateEvents = wEvents.filter(
      (e) => e.event_type === "working" || e.event_type === "idle",
    );

    for (let i = 0; i < stateEvents.length - 1; i++) {
      const current = stateEvents[i];
      const next = stateEvents[i + 1];
      if (!workerMetrics[workerId]) continue;

      const durationSec = differenceInSeconds(
        new Date(next.timestamp),
        new Date(current.timestamp),
      );

      if (current.event_type === "working")
        workerMetrics[workerId].active_time += durationSec;
      if (current.event_type === "idle")
        workerMetrics[workerId].idle_time += durationSec;
    }
  });

  // Format final output
  let totalUnits = 0;
  const formattedWorkers = Object.keys(workerMetrics).map((id) => {
    const wm = workerMetrics[id];
    const totalTime = wm.active_time + wm.idle_time;
    const utilization =
      totalTime > 0 ? Math.round((wm.active_time / totalTime) * 100) : 0;
    totalUnits += wm.units;

    return {
      worker_id: id,
      name: wm.name,
      active_time: wm.active_time,
      idle_time: wm.idle_time,
      utilization,
      units_per_hour:
        wm.active_time > 0 ? Math.round(wm.units / (wm.active_time / 3600)) : 0,
    };
  });

  return {
    factory: {
      total_units: totalUnits,
      utilization: Math.round(
        formattedWorkers.reduce((acc, w) => acc + w.utilization, 0) /
          (formattedWorkers.length || 1),
      ),
    },
    workers: formattedWorkers,
  };
}
