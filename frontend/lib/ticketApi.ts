import { apiClient } from "@/lib/apiClient";
import type { StatusColumn } from "@/lib/data";

// Statuses are per-project rows in the backend (id + name) and tickets point
// at them through status_id. Every write that goes through the backend
// (POST /tickets, PUT /tickets/:id) also clears the Redis-cached project
// summary and assignee dashboard on the server, so the next
// GET /summary/:id comes back with fresh numbers.

// Names matter: the summary endpoint counts "Done" and "In Progress" by name.
export const DEFAULT_STATUS_NAMES = ["To Do", "In Progress", "Review", "Done"];

export async function getProjectStatuses(projectId: string): Promise<StatusColumn[]> {
  const res = await apiClient.get(`/project/${projectId}/statuses`);
  return res.data?.statuses ?? [];
}

export async function createStatus(projectId: string, name: string): Promise<StatusColumn> {
  const res = await apiClient.post(`/project/${projectId}/statuses`, { name });
  return res.data.status_record as StatusColumn;
}

// For a project with no statuses yet. Created one by one so positions come out
// in order; a name that already exists (409) is skipped.
export async function createDefaultStatuses(projectId: string): Promise<StatusColumn[]> {
  for (const name of DEFAULT_STATUS_NAMES) {
    try {
      await createStatus(projectId, name);
    } catch {
      // already exists, or a parallel request created it
    }
  }
  return getProjectStatuses(projectId);
}

// The id new tickets should start in: the project's first column. Creates the
// default columns first if the project has none (which would otherwise make
// POST /tickets fail with "no statuses set up yet").
export async function getDefaultStatusId(projectId: string): Promise<string> {
  let list = await getProjectStatuses(projectId);
  if (list.length === 0) list = await createDefaultStatuses(projectId);
  const first = [...list].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
  if (!first) throw new Error("This project has no statuses and none could be created.");
  return first.id;
}

export async function changeTicketStatus(ticketId: string, statusId: string): Promise<void> {
  await apiClient.put(`/tickets/${ticketId}`, { status_id: statusId });
}

export function errorMessage(err: unknown, fallback: string): string {
  const e = err as {
    response?: { status?: number; data?: { message?: string; error?: string } };
    message?: string;
  };
  if (e?.response?.status === 403) return "Only Admins and Editors can change a ticket's status.";
  return e?.response?.data?.message || e?.response?.data?.error || e?.message || fallback;
}