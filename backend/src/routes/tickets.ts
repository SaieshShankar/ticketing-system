import { Router, Request, Response } from "express";
import { authenticate, requireRole } from "../middleware/auth";
import prisma from "../lib/prisma";
import { invalidate, cacheKey } from "../lib/cache"; // CHANGED

const router = Router();

// ── helper: check user is a member of the ticket's project ──────────────────
async function isProjectMember(projectId: string, userId: string): Promise<boolean> {
  const member = await prisma.project_members.findFirst({
    where: { project_id: projectId, user_id: userId },
  });
  return !!member;
}

// ── helper: validate a status_id belongs to the given project ───────────────
async function getValidStatus(projectId: string, statusId: string) {
  return prisma.statuses.findFirst({ where: { id: statusId, project_id: projectId } });
}

// ── helper: get the default (lowest-position) status for a project ──────────
async function getDefaultStatus(projectId: string) {
  return prisma.statuses.findFirst({
    where: { project_id: projectId },
    orderBy: { position: "asc" },
  });
}

const statusInclude = { select: { id: true, name: true, color: true, position: true } };

// POST /api/tickets — Admin + Editor + User
router.post("/", authenticate, requireRole(["Admin", "Editor", "User"]), async (req: Request, res: Response) => {
  try {
    const { title, description, status_id, priority, ticket_order, project_id, assigned_to, due_date } = req.body;

    if (!title) return res.status(400).json({ status: "400", message: "title is required" });
    if (!project_id) return res.status(400).json({ status: "400", message: "project_id is required" });

    const validPriorities = ["Low", "Medium", "High", "Critical"];
    if (priority && !validPriorities.includes(priority)) {
      return res.status(400).json({ status: "400", message: `priority must be one of: ${validPriorities.join(", ")}` });
    }

    const project = await prisma.projects.findUnique({ where: { id: project_id as string } });
    if (!project) return res.status(404).json({ status: "404", message: "Project not found" });

    // assigned_to must be a project member
    if (assigned_to) {
      const isMember = await isProjectMember(project_id, assigned_to);
      if (!isMember) {
        return res.status(400).json({ status: "400", message: "Assigned user is not a member of this project" });
      }
    }

    // Resolve status_id — validate it if given, otherwise fall back to the project's default
    let resolvedStatusId: string | null = null;
    if (status_id) {
      const validStatus = await getValidStatus(project_id, status_id);
      if (!validStatus) {
        return res.status(400).json({ status: "400", message: "status_id does not belong to this project" });
      }
      resolvedStatusId = validStatus.id;
    } else {
      const defaultStatus = await getDefaultStatus(project_id);
      if (!defaultStatus) {
        return res.status(400).json({ status: "400", message: "This project has no statuses set up yet — create one via POST /api/project/:projectId/statuses first" });
      }
      resolvedStatusId = defaultStatus.id;
    }

    const count = await prisma.tickets.count({ where: { project_id } });
    const shortProjectId = project_id.slice(0, 4).toUpperCase();
    const ticket_number = `${shortProjectId}-${String(count + 1).padStart(4, "0")}`;

    const ticket = await prisma.tickets.create({
      data: {
        ticket_number,
        title,
        description: description ?? null,
        status_id: resolvedStatusId,
        priority: priority ?? "Medium",
        ticket_order: ticket_order ?? null,
        project_id,
        created_by: req.user!.id,
        assigned_to: assigned_to ?? null,
        due_date: due_date ? new Date(due_date) : null,
        ticket_activity_logs: {
          create: { user_id: req.user!.id, action: "ticket created" } as any,
        },
      },
      include: {
        users_tickets_created_byTousers: { select: { id: true, name: true, email: true } },
        users_tickets_assigned_toTousers: { select: { id: true, name: true, email: true } },
        projects: { select: { id: true, name: true } },
        statuses: statusInclude,
      },
    });

    // CHANGED: drop cached summary + assignee dashboard
    await invalidate(
      cacheKey.summary(project_id),
      assigned_to && cacheKey.dashboard(assigned_to)
    );

    res.status(201).json({ status: "201", message: "Ticket created successfully", ticket });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ status: "500", message: "Failed to create ticket", detail: error.message });
  }
});

// GET /api/tickets — all roles, with filters
// status can be filtered by exact status_id, or by name via ?status=Done (case-insensitive)
router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const { project_id, status_id, status, priority, assigned_to, created_by, search, overdue } = req.query;

    const tickets = await prisma.tickets.findMany({
      where: {
        ...(project_id && { project_id: String(project_id) }),
        ...(status_id && { status_id: String(status_id) }),
        ...(status && { statuses: { name: { equals: String(status), mode: "insensitive" } } }),
        ...(priority && { priority: String(priority) }),
        ...(assigned_to && { assigned_to: String(assigned_to) }),
        ...(created_by && { created_by: String(created_by) }),
        ...(search && { title: { contains: String(search), mode: "insensitive" } }),
        ...(overdue === "true" && { due_date: { lt: new Date() } }),
      },
      orderBy: { created_at: "desc" },
      include: {
        users_tickets_created_byTousers: { select: { id: true, name: true, email: true } },
        users_tickets_assigned_toTousers: { select: { id: true, name: true, email: true } },
        projects: { select: { id: true, name: true } },
        statuses: statusInclude,
        comments: true,
        attachments: true,
      },
    });

    res.json({ status: "200", total: tickets.length, tickets });
  } catch (error: any) {
    res.status(500).json({ status: "500", message: "Failed to fetch tickets", detail: error.message });
  }
});

// GET /api/tickets/:id/logs — must be above /:id
router.get("/:id/logs", authenticate, async (req: Request, res: Response) => {
  try {
    const logs = await prisma.ticket_activity_logs.findMany({
      where: { ticket_id: req.params.id as string },
      include: { users: { select: { id: true, name: true, email: true } } },
      orderBy: { created_at: "desc" },
    });

    res.json({ status: "200", total: logs.length, logs });
  } catch (error: any) {
    res.status(500).json({ status: "500", message: "Failed to fetch logs", detail: error.message });
  }
});

// GET /api/tickets/:id — all roles
router.get("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const ticket = await prisma.tickets.findUnique({
      where: { id: req.params.id as string },
      include: {
        users_tickets_created_byTousers: { select: { id: true, name: true, email: true } },
        users_tickets_assigned_toTousers: { select: { id: true, name: true, email: true } },
        projects: { select: { id: true, name: true } },
        statuses: statusInclude,
        comments: {
          include: { users: { select: { id: true, name: true, email: true } } },
          orderBy: { created_at: "asc" },
        },
        attachments: true,
        ticket_activity_logs: {
          include: { users: { select: { id: true, name: true, email: true } } },
          orderBy: { created_at: "desc" },
        },
      },
    });

    if (!ticket) return res.status(404).json({ status: "404", message: "Ticket not found" });
    res.json({ status: "200", ticket });
  } catch (error: any) {
    res.status(500).json({ status: "500", message: "Failed to fetch ticket", detail: error.message });
  }
});

// PUT /api/tickets/:id — Admin + Editor only
router.put("/:id", authenticate, requireRole(["Admin", "Editor"]), async (req: Request, res: Response) => {
  try {
    const { title, description, status_id, priority, ticket_order, assigned_to, due_date, closed_at } = req.body;

    const validPriorities = ["Low", "Medium", "High", "Critical"];
    if (priority && !validPriorities.includes(priority)) {
      return res.status(400).json({ status: "400", message: `priority must be one of: ${validPriorities.join(", ")}` });
    }

    const existing = await prisma.tickets.findUnique({ where: { id: req.params.id as string } });
    if (!existing) return res.status(404).json({ status: "404", message: "Ticket not found" });

    // assigned_to must be a project member
    if (assigned_to !== undefined && assigned_to !== null) {
      const isMember = await isProjectMember(existing.project_id, assigned_to);
      if (!isMember) {
        return res.status(400).json({ status: "400", message: "Assigned user is not a member of this project" });
      }
    }

    // Validate the new status belongs to this ticket's project, and grab both
    // old + new status names for a readable activity log entry
    let oldStatusName: string | null = null;
    let newStatusName: string | null = null;
    if (status_id !== undefined && status_id !== existing.status_id) {
      const validStatus = await getValidStatus(existing.project_id, status_id);
      if (!validStatus) {
        return res.status(400).json({ status: "400", message: "status_id does not belong to this ticket's project" });
      }
      newStatusName = validStatus.name;
      if (existing.status_id) {
        const oldStatus = await prisma.statuses.findUnique({ where: { id: existing.status_id } });
        oldStatusName = oldStatus?.name ?? null;
      }
    }

    const changes: string[] = [];
    if (newStatusName) changes.push(`status changed from ${oldStatusName ?? "none"} to ${newStatusName}`);
    if (priority && priority !== existing.priority) changes.push(`priority changed from ${existing.priority} to ${priority}`);
    if (title && title !== existing.title) changes.push(`title updated`);
    if (assigned_to !== undefined && assigned_to !== existing.assigned_to) changes.push(`assignee updated`);
    if (due_date !== undefined) changes.push(`due date updated`);
    const action = changes.length > 0 ? changes.join(", ") : "ticket updated";

    const [updated] = await prisma.$transaction([
      prisma.tickets.update({
        where: { id: req.params.id as string },
        data: {
          ...(title && { title }),
          ...(description !== undefined && { description }),
          ...(status_id !== undefined && { status_id }),
          ...(priority && { priority }),
          ...(ticket_order !== undefined && { ticket_order }),
          ...(assigned_to !== undefined && { assigned_to }),
          ...(due_date !== undefined && { due_date: due_date ? new Date(due_date) : null }),
          ...(closed_at !== undefined && { closed_at: closed_at ? new Date(closed_at) : null }),
          updated_at: new Date(),
        },
        include: {
          users_tickets_created_byTousers: { select: { id: true, name: true, email: true } },
          users_tickets_assigned_toTousers: { select: { id: true, name: true, email: true } },
          projects: { select: { id: true, name: true } },
          statuses: statusInclude,
        },
      }),
      prisma.ticket_activity_logs.create({
        data: { ticket_id: req.params.id as string, user_id: req.user!.id, action } as any,
      }),
    ]);

    // CHANGED: drop cached summary + old and new assignee dashboards
    await invalidate(
      cacheKey.summary(existing.project_id),
      existing.assigned_to && cacheKey.dashboard(existing.assigned_to),
      assigned_to && cacheKey.dashboard(assigned_to)
    );

    res.json({ status: "200", message: "Ticket updated successfully", ticket: updated });
  } catch (error: any) {
    res.status(500).json({ status: "500", message: "Failed to update ticket", detail: error.message });
  }
});

// DELETE /api/tickets/:id — Admin only
router.delete("/:id", authenticate, requireRole(["Admin"]), async (req: Request, res: Response) => {
  try {
    const existing = await prisma.tickets.findUnique({ where: { id: req.params.id as string } });
    if (!existing) return res.status(404).json({ message: "Ticket not found", status: "404" });

    await prisma.tickets.delete({ where: { id: req.params.id as string } });

    // CHANGED: drop cached summary + assignee dashboard
    await invalidate(
      cacheKey.summary(existing.project_id),
      existing.assigned_to && cacheKey.dashboard(existing.assigned_to)
    );

    res.json({ status: "200", message: "Ticket deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ status: "500", message: "Failed to delete ticket", detail: error.message });
  }
});

// ─────────────────────────────────────────────
// COMMENTS — with @mention support + notifications
// ─────────────────────────────────────────────

// POST /api/tickets/:id/comments — any authenticated user
router.post("/:id/comments", authenticate, async (req: Request, res: Response) => {
  try {
    const { comment_text } = req.body;
    const ticketId = req.params.id as string;

    if (!comment_text || !comment_text.trim()) {
      return res.status(400).json({ status: "400", message: "comment_text is required" });
    }

    const ticket = await prisma.tickets.findUnique({ where: { id: ticketId } });
    if (!ticket) return res.status(404).json({ status: "404", message: "Ticket not found" });

    const comment = await prisma.comments.create({
      data: {
        ticket_id: ticketId,
        user_id: req.user!.id,
        comment_text: comment_text.trim(),
      },
      include: {
        users: { select: { id: true, name: true, email: true } },
      },
    });

    const mentionRegex = /@(\w+)/g;
    const mentionedNames = [...comment_text.matchAll(mentionRegex)].map((m) => m[1]);

    if (mentionedNames.length > 0) {
      const mentionedUsers = await prisma.users.findMany({
        where: {
          name: { in: mentionedNames },
          project_members: { some: { project_id: ticket.project_id } },
        },
        select: { id: true, name: true },
      });

      if (mentionedUsers.length > 0) {
        await prisma.ticket_activity_logs.create({
          data: {
            ticket_id: ticketId,
            user_id: req.user!.id,
            action: `mentioned ${mentionedUsers.map((u) => "@" + u.name).join(", ")} in a comment`,
          } as any,
        });

        const recipients = mentionedUsers.filter((u) => u.id !== req.user!.id);
        if (recipients.length > 0) {
          await prisma.notifications.createMany({
            data: recipients.map((u) => ({
              user_id: u.id,
              actor_id: req.user!.id,
              ticket_id: ticketId,
              comment_id: comment.id,
              type: "mention",
              message: "mentioned you in a comment",
            })),
          });
        }
      }
    }

    res.status(201).json({ status: "201", message: "Comment added successfully", comment });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ status: "500", message: "Failed to add comment", detail: error.message });
  }
});

// GET /api/tickets/:id/comments — all roles
router.get("/:id/comments", authenticate, async (req: Request, res: Response) => {
  try {
    const ticketId = req.params.id as string;

    const comments = await prisma.comments.findMany({
      where: { ticket_id: ticketId },
      include: {
        users: { select: { id: true, name: true, email: true } },
        attachments: true,
      },
      orderBy: { created_at: "asc" },
    });

    res.json({ status: "200", total: comments.length, comments });
  } catch (error: any) {
    res.status(500).json({ status: "500", message: "Failed to fetch comments", detail: error.message });
  }
});

// DELETE /api/tickets/:ticketId/comments/:commentId — comment owner or Admin
router.delete("/:ticketId/comments/:commentId", authenticate, async (req: Request, res: Response) => {
  try {
    const comment = await prisma.comments.findUnique({
      where: { id: req.params.commentId as string },
    });

    if (!comment) return res.status(404).json({ status: "404", message: "Comment not found" });

    if (comment.user_id !== req.user!.id && req.user!.role !== "Admin") {
      return res.status(403).json({ status: "403", message: "Not allowed to delete this comment" });
    }

    await prisma.comments.delete({ where: { id: req.params.commentId as string } });
    res.json({ status: "200", message: "Comment deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ status: "500", message: "Failed to delete comment", detail: error.message });
  }
});

export default router;