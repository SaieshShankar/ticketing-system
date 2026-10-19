import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { cached, cacheKey } from "../lib/cache"; // CHANGED

const router = Router();

// GET /api/summary/:projectId — stats for the Summary tab
router.get("/:projectId", authenticate, async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId as string;
    const userId = req.user?.id;

    const project = await prisma.projects.findUnique({
      where: { id: projectId },
      select: { id: true, user_id: true, super_admin_id: true },
    });

    if (!project) {
      return res.status(404).json({ status: "404", message: "Project not found" });
    }

    // auth check stays OUTSIDE the cache so cached data never bypasses permissions
    const isMember = await prisma.project_members.findFirst({
      where: { project_id: projectId, user_id: userId } as any,
    });
    const isOwner = project.user_id === userId || project.super_admin_id === userId;

    if (!isMember && !isOwner) {
      return res.status(403).json({ status: "403", message: "Not a member of this project" });
    }

    // CHANGED: Redis first, else Prisma, stored for 60s
const data = await cached(cacheKey.summary(projectId), 300, async () => {      const tickets = await prisma.tickets.findMany({
        where: { project_id: projectId },
        select: {
          id: true,
          created_at: true,
          statuses: { select: { name: true } },
        },
      });

      const total = tickets.length;
      const resolved = tickets.filter((t) => t.statuses?.name === "Done").length;
      const inProgress = tickets.filter((t) => t.statuses?.name === "In Progress").length;
      const open = total - resolved - inProgress;

      // Trend: tickets created per day, last 7 days (oldest -> newest)
      const today = new Date();
      const trend: { day: string; tickets: number }[] = [];

      for (let i = 6; i >= 0; i--) { // CHANGED: was `i = 0; i >= 6` so the loop never ran
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dayStart = new Date(d);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(d);
        dayEnd.setHours(23, 59, 59, 999);

        const count = tickets.filter((t) => {
          if (!t.created_at) return false;
          const c = new Date(t.created_at);
          return c >= dayStart && c <= dayEnd;
        }).length;

        trend.push({
          day: dayStart.toLocaleDateString("en-US", { weekday: "short" }),
          tickets: count,
        });
      }
      // CHANGED: removed the dayOrder sort, it reordered days Mon–Sun instead of oldest -> newest

      return { total, open, inProgress, resolved, trend };
    });

    res.json({ status: "200", data });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ status: "500", message: "Failed to fetch summary", detail: error.message });
  }
});

export default router;