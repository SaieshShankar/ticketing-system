
"use client";

import { useState } from "react";
import Link from "next/link";
import { Ticket, StatusColumn, PRIORITY_COLORS, statusBadge } from "@/lib/data";

interface KanbanBoardProps {
  tickets: Ticket[];
  projectId: string;
  // The project's real statuses (one board column each)
  columns: StatusColumn[];
  onStatusChange: (ticketId: string, column: StatusColumn) => void;
  onAddStatus?: (name: string) => Promise<void>;
  onCreateDefaults?: () => Promise<void>;
}

const PRIORITY_SHORT: Record<string, string> = {
  High: "H",
  Medium: "M",
  Low: "L",
};

export default function KanbanBoard({
  tickets,
  projectId,
  columns,
  onStatusChange,
  onAddStatus,
  onCreateDefaults,
}: KanbanBoardProps) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [filter, setFilter] = useState({ assignee: "", priority: "" });

  const [adding, setAdding] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState("");

  // Use a stable key per assignee (their id when we have one, otherwise the
  // name) so two different tickets assigned to the same person always match,
  // and so the dropdown works even for "Unassigned" tickets.
  const assigneeKey = (t: Ticket) => t.assignedToId || t.assignee;

  const filtered = tickets.filter((t) => {
    if (filter.priority && t.priority !== filter.priority) return false;
    if (filter.assignee && assigneeKey(t) !== filter.assignee) return false;
    return true;
  });

  // Which column a ticket belongs to: its status id, else its status name,
  // else the first column (so a ticket without a status never disappears).
  const columnIdFor = (t: Ticket): string | undefined => {
    if (t.statusId && columns.some((c) => c.id === t.statusId)) return t.statusId;
    const byName = columns.find((c) => c.name.toLowerCase() === String(t.status).toLowerCase());
    return byName?.id ?? columns[0]?.id;
  };

  const byColumn = (col: StatusColumn) => filtered.filter((t) => columnIdFor(t) === col.id);

  // De-duplicated list of { key, label } assignee options, built from the
  // full ticket list (not the already-filtered one) so the dropdown always
  // shows every possible choice.
  const assignees = Array.from(
    new Map(tickets.map((t) => [assigneeKey(t), t.assignee])).entries()
  ).map(([key, label]) => ({ key, label }));

  const handleDragStart = (id: string) => setDragging(id);
  const handleDragEnd = () => { setDragging(null); setOverCol(null); };
  const handleDrop = (col: StatusColumn) => {
    if (!dragging) return;
    onStatusChange(dragging, col);
    setDragging(null);
    setOverCol(null);
  };

  const submitNewStatus = async () => {
    const name = newStatus.trim();
    if (!name || !onAddStatus) return;
    setStatusBusy(true);
    setStatusError("");
    try {
      await onAddStatus(name);
      setNewStatus("");
      setAdding(false);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setStatusError(status === 409 ? "That status already exists." : "Could not add the status.");
    } finally {
      setStatusBusy(false);
    }
  };

  const createDefaults = async () => {
    if (!onCreateDefaults) return;
    setStatusBusy(true);
    setStatusError("");
    try {
      await onCreateDefaults();
    } catch {
      setStatusError("Could not create the default statuses.");
    } finally {
      setStatusBusy(false);
    }
  };

  const TicketCard = ({ ticket }: { ticket: Ticket }) => (
    <div
      draggable
      onDragStart={() => handleDragStart(ticket.id)}
      onDragEnd={handleDragEnd}
      className={`bg-white border border-slate-200 rounded-lg p-2.5 shadow-sm hover:shadow-md hover:border-violet-200 transition-all cursor-grab active:cursor-grabbing ${dragging === ticket.id ? "opacity-40" : ""}`}
    >
      <div className="flex items-start justify-between gap-1 mb-1.5">
        <Link
          href={`/project/${projectId}/ticket/${ticket.id}`}
          className="text-[10px] font-bold text-slate-400 hover:text-violet-600 transition-colors font-mono leading-tight"
        >
          {ticket.ticketNumber || ticket.id}
        </Link>

        {/* Mobile: show H / M / L */}
        <span className={`sm:hidden text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border shrink-0 ${PRIORITY_COLORS[ticket.priority]}`}>
          {PRIORITY_SHORT[ticket.priority] ?? ticket.priority[0]}
        </span>

        {/* Desktop: show full label */}
        <span className={`hidden sm:inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap shrink-0 ${PRIORITY_COLORS[ticket.priority]}`}>
          {ticket.priority}
        </span>
      </div>

      <Link
        href={`/project/${projectId}/ticket/${ticket.id}`}
        className="text-[11px] font-medium text-slate-800 hover:text-violet-700 transition-colors line-clamp-2 block leading-snug"
      >
        {ticket.title}
      </Link>
      {ticket.assignee !== "Unassigned" && (
        <div className="flex items-center gap-1 mt-2">
          <div className="w-4 h-4 bg-violet-100 rounded-full flex items-center justify-center text-[9px] font-bold text-violet-700 shrink-0">
            {ticket.assignee[0]}
          </div>
          <span className="text-[10px] text-slate-400 truncate">{ticket.assignee}</span>
        </div>
      )}

      {/* Explicit "move to" control — works even if drag-and-drop doesn't
          (e.g. on touch devices, or browsers that block native HTML5 DnD) */}
      <select
        value={columnIdFor(ticket) ?? ""}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const col = columns.find((c) => c.id === e.target.value);
          if (col) onStatusChange(ticket.id, col);
        }}
        className="mt-2 w-full text-[10px] border border-slate-200 rounded px-1.5 py-1 bg-slate-50 text-slate-600 focus:outline-none focus:ring-1 focus:ring-violet-300"
      >
        {columns.map((col) => (
          <option key={col.id} value={col.id}>
            Move to: {col.name}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="w-full">

      {/* ── Filters: single scrollable row on mobile, wrap on sm+ ── */}
      <div
        className="flex gap-2 mb-5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0"
        style={{ scrollbarWidth: "none" } as React.CSSProperties}
      >
        <select
          value={filter.assignee}
          onChange={(e) => setFilter({ ...filter, assignee: e.target.value })}
          className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-300 shrink-0 min-w-max"
        >
          <option value="">All Assignees</option>
          {assignees.map((a) => (
            <option key={a.key} value={a.key}>{a.label}</option>
          ))}
        </select>

        <select
          value={filter.priority}
          onChange={(e) => setFilter({ ...filter, priority: e.target.value })}
          className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-300 shrink-0 min-w-max"
        >
          <option value="">All Priorities</option>
          <option>Critical</option>
          <option>High</option>
          <option>Medium</option>
          <option>Low</option>
        </select>

        {(filter.priority || filter.assignee) && (
          <button
            onClick={() => setFilter({ assignee: "", priority: "" })}
            className="text-xs text-red-500 hover:text-red-700 px-2 shrink-0 min-w-max"
          >
            Clear filters
          </button>
        )}

        {onAddStatus && columns.length > 0 && !adding && (
          <button
            onClick={() => { setStatusError(""); setAdding(true); }}
            className="ml-auto text-xs font-semibold text-violet-700 border border-violet-200 bg-violet-50 hover:bg-violet-100 rounded-lg px-3 py-1.5 shrink-0 min-w-max"
          >
            + Add status
          </button>
        )}
      </div>

      {adding && (
        <div className="flex items-center gap-2 mb-4">
          <input
            autoFocus
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submitNewStatus(); }}
            placeholder="New status name"
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          <button
            onClick={() => void submitNewStatus()}
            disabled={statusBusy || !newStatus.trim()}
            className="text-xs font-semibold bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-lg px-3 py-1.5"
          >
            {statusBusy ? "Adding..." : "Add"}
          </button>
          <button
            onClick={() => { setAdding(false); setNewStatus(""); setStatusError(""); }}
            className="text-xs text-slate-500 hover:text-slate-700 px-2"
          >
            Cancel
          </button>
        </div>
      )}

      {statusError && <p className="text-xs text-red-500 mb-3">{statusError}</p>}

      {/* ── No statuses yet ── */}
      {columns.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl text-center py-12 px-4">
          <p className="text-sm text-slate-500 mb-4">
            This project has no statuses yet, so there are no columns to show.
          </p>
          {onCreateDefaults && (
            <button
              onClick={() => void createDefaults()}
              disabled={statusBusy}
              className="text-sm font-semibold bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-lg px-4 py-2"
            >
              {statusBusy ? "Creating..." : "Create default statuses"}
            </button>
          )}
          <p className="text-xs text-slate-400 mt-3">To Do · In Progress · Review · Done</p>
        </div>
      )}

      {/* ── Kanban Grid ── */}
      {/* Always scrolls horizontally. Each column min 150px on mobile, 180px on sm+ */}
      {columns.length > 0 && (
        <div className="w-full overflow-x-auto pb-4">
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(${columns.length}, minmax(150px, 1fr))`,
              minWidth: `${columns.length * 150}px`,
            }}
          >
            {columns.map((col) => {
              const colTickets = byColumn(col);
              const isOver = overCol === col.id;
              return (
                <div
                  key={col.id}
                  className={`rounded-xl transition-colors ${isOver ? "bg-violet-50 ring-2 ring-violet-300" : "bg-slate-100"}`}
                  onDragOver={(e) => { e.preventDefault(); setOverCol(col.id); }}
                  onDrop={() => handleDrop(col)}
                  onDragLeave={() => setOverCol(null)}
                >
                  <div className="flex items-center gap-1.5 px-3 py-2.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${statusBadge(col.name)}`}>
                      {col.name}
                    </span>
                    <span className="text-xs text-slate-400 font-medium shrink-0">
                      ({colTickets.length})
                    </span>
                  </div>

                  <div className="px-2 pb-2 space-y-2 min-h-24">
                    {colTickets.map((ticket) => (
                      <TicketCard key={ticket.id} ticket={ticket} />
                    ))}
                    {colTickets.length === 0 && (
                      <div className="text-xs text-slate-300 text-center py-4">
                        Drop tickets here
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}