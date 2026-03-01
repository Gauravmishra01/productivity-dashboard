import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import { computeMetrics } from "./metrics";
import { seedDatabase } from "./services/seed";

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

app.post("/api/events", async (req, res) => {
  const {
    timestamp,
    worker_id,
    workstation_id,
    event_type,
    confidence,
    count,
  } = req.body;
  try {
    const event = await prisma.event.upsert({
      where: {
        worker_id_timestamp_event_type: {
          worker_id,
          timestamp: new Date(timestamp),
          event_type,
        },
      },
      update: {},
      create: {
        timestamp: new Date(timestamp),
        worker_id,
        workstation_id,
        event_type,
        confidence,
        count: count || 0,
      },
    });
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

app.get("/api/metrics", async (req, res) => {
  const events = await prisma.event.findMany({ orderBy: { timestamp: "asc" } });
  const workers = await prisma.worker.findMany();
  const workstations = await prisma.workstation.findMany();
  res.json(computeMetrics(events, workers, workstations));
});

app.post("/api/seed", async (req, res) => {
  await seedDatabase(prisma);
  res.json({ message: "Seeded" });
});

app.listen(3001, () => console.log("Backend on 3001"));
