import { PrismaClient } from "@prisma/client";

export async function seedDatabase(prisma: PrismaClient) {
  await prisma.event.deleteMany();
  await prisma.worker.deleteMany();
  await prisma.workstation.deleteMany();

  const workers = Array.from({ length: 6 }).map((_, i) => ({
    worker_id: `W${i + 1}`,
    name: `Worker ${i + 1}`,
  }));
  const stations = Array.from({ length: 6 }).map((_, i) => ({
    station_id: `S${i + 1}`,
    name: `Station ${i + 1}`,
  }));

  await prisma.worker.createMany({ data: workers });
  await prisma.workstation.createMany({ data: stations });

  const events = [];
  const baseTime = new Date();

  for (let w of workers) {
    for (let i = 0; i < 10; i++) {
      const isWorking = Math.random() > 0.3;
      events.push({
        worker_id: w.worker_id,
        workstation_id: stations[0].station_id,
        event_type: isWorking ? "working" : "idle",
        confidence: 0.9 + Math.random() * 0.1,
        timestamp: new Date(baseTime.getTime() + i * 3600000), // Every hour
      });
      if (isWorking) {
        events.push({
          worker_id: w.worker_id,
          workstation_id: stations[0].station_id,
          event_type: "product_count",
          count: Math.floor(Math.random() * 50) + 10,
          confidence: 0.95,
          timestamp: new Date(baseTime.getTime() + i * 3600000 + 1000), // 1 sec later
        });
      }
    }
  }
  await prisma.event.createMany({ data: events });
}
