import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/auth";
import prisma from "../lib/prisma";

const router = Router();

// GET /api/notifications — current user's notifications, unread first
// ?unread=true to only get unread ones
router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const unreadOnly = req.query.unread === "true";

    const notifications = await prisma.notifications.findMany({
      where: {
        user_id: userId,
        ...(unreadOnly && { is_read: false }),
      },
      include: {
        users_notifications_actor_idTousers: { select: { id: true, name: true, email: true } },
        tickets: { select: { id: true, title: true, ticket_number: true } },
      },
      orderBy: [{ is_read: "asc" }, { created_at: "desc" }],
    });

    const unread_count = await prisma.notifications.count({
      where: { user_id: userId, is_read: false },
    });

    res.json({
      status: "200",
      total: notifications.length,
      unread_count,
      notifications: notifications.map(({ users_notifications_actor_idTousers, ...notification }) => ({
        ...notification,
        actor: users_notifications_actor_idTousers,
      })),
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ status: "500", message: "Failed to fetch notifications", detail: error.message });
  }
});

// PATCH /api/notifications/:id/read — mark a single notification as read
router.patch("/:id/read", authenticate, async (req: Request, res: Response) => {
  try {
    const notification = await prisma.notifications.findUnique({ where: { id: req.params.id as string } });
    if (!notification) return res.status(404).json({ status: "404", message: "Notification not found" });

    if (notification.user_id !== req.user!.id) {
      return res.status(403).json({ status: "403", message: "Not allowed to modify this notification" });
    }

    const updated = await prisma.notifications.update({
      where: { id: req.params.id as string },
      data: { is_read: true },
    });

    res.json({ status: "200", message: "Notification marked as read", notification: updated });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ status: "500", message: "Failed to update notification", detail: error.message });
  }
});

// PATCH /api/notifications/read-all — mark every unread notification for the current user as read
router.patch("/read-all", authenticate, async (req: Request, res: Response) => {
  try {
    const result = await prisma.notifications.updateMany({
      where: { user_id: req.user!.id, is_read: false },
      data: { is_read: true },
    });

    res.json({ status: "200", message: "All notifications marked as read", updated: result.count });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ status: "500", message: "Failed to update notifications", detail: error.message });
  }
});

// DELETE /api/notifications/:id — remove a single notification
router.delete("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const notification = await prisma.notifications.findUnique({ where: { id: req.params.id as string } });
    if (!notification) return res.status(404).json({ status: "404", message: "Notification not found" });

    if (notification.user_id !== req.user!.id) {
      return res.status(403).json({ status: "403", message: "Not allowed to delete this notification" });
    }

    await prisma.notifications.delete({ where: { id: req.params.id as string } });
    res.json({ status: "200", message: "Notification deleted successfully" });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ status: "500", message: "Failed to delete notification", detail: error.message });
  }
});

export default router;
