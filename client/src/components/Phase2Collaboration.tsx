import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Could not save this change. Please try again.";
}

export function CollaborationPanels({
  familyId,
  userId,
  canWrite,
}: {
  familyId: number;
  userId: number;
  canWrite: boolean;
}) {
  const requests = trpc.care.collaboration.requests.useQuery({ familyId });
  const absences = trpc.care.absences.list.useQuery({ familyId });
  const audit = trpc.care.audit.list.useQuery({ familyId });
  const tasks = trpc.care.tasks.list.useQuery({ familyId });
  const members = trpc.care.families.members.useQuery({ familyId });
  const utils = trpc.useUtils();
  const createRequest = trpc.care.collaboration.request.useMutation();
  const respondRequest = trpc.care.collaboration.respond.useMutation();
  const createAbsence = trpc.care.absences.create.useMutation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const refresh = async () =>
    Promise.all([
      utils.care.collaboration.requests.invalidate({ familyId }),
      utils.care.absences.list.invalidate({ familyId }),
      utils.care.audit.list.invalidate({ familyId }),
      utils.care.tasks.list.invalidate({ familyId }),
    ]);
  const run = async (operation: () => Promise<unknown>, message: string) => {
    setSaving(true);
    setError("");
    try {
      await operation();
      await refresh();
      toast.success(message);
    } catch (cause) {
      setError(errorMessage(cause));
      toast.error(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };
  const people = members.data ?? [];
  const personName = (id: number) =>
    people.find(person => person.userId === id)?.name || "Family member";
  const pendingRequests = (requests.data ?? []).filter(
    item => item.status === "pending"
  );

  return (
    <div className="phase2-stack">
      <section className="panel full-panel phase2-panel">
        <h2>Ask for help or request a responsibility swap</h2>
        <p className="form-hint">
          A task only changes hands after the named family member explicitly
          accepts. No message or notification is sent outside this app.
        </p>
        {requests.isLoading ? (
          <p className="loading-state">Loading task requests…</p>
        ) : requests.error ? (
          <p className="data-error" role="alert">
            Requests could not be loaded.{" "}
            <button
              className="text-action"
              onClick={() => void requests.refetch()}
            >
              Try again
            </button>
          </p>
        ) : (
          <>
            {canWrite && (
              <form
                className="phase2-inline-form"
                onSubmit={event => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void run(
                    () =>
                      createRequest.mutateAsync({
                        familyId,
                        taskId: Number(data.get("taskId")),
                        targetId: Number(data.get("targetId")),
                        kind: String(data.get("kind")) as "help" | "swap",
                      }),
                    "Request sent to the selected family member."
                  );
                  event.currentTarget.reset();
                }}
              >
                <label>
                  Task
                  <select name="taskId" required defaultValue="">
                    <option value="" disabled>
                      Select a task
                    </option>
                    {(tasks.data ?? [])
                      .filter(task => task.status !== "completed")
                      .map(task => (
                        <option key={task.id} value={task.id}>
                          {task.title}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Request
                  <select name="kind">
                    <option value="help">Ask for help (offer task)</option>
                    <option value="swap">Request a responsibility swap</option>
                  </select>
                </label>
                <label>
                  Family member
                  <select name="targetId" required defaultValue="">
                    <option value="" disabled>
                      Select a recipient
                    </option>
                    {people
                      .filter(person => person.userId !== userId)
                      .map(person => (
                        <option key={person.userId} value={person.userId}>
                          {person.name || "Family member"}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  className="button button-primary"
                  disabled={
                    saving ||
                    !people.length ||
                    !tasks.data?.some(task => task.status !== "completed")
                  }
                >
                  Send request
                </button>
              </form>
            )}
            {error && (
              <p className="data-error" role="alert">
                {error}
              </p>
            )}
            {pendingRequests.length === 0 ? (
              <p className="phase2-empty">
                No pending requests. Resolved requests remain listed below.
              </p>
            ) : (
              pendingRequests.map(item => (
                <article className="phase2-record" key={item.id}>
                  <div>
                    <strong>
                      {item.kind === "help"
                        ? "Help request"
                        : "Responsibility swap"}
                    </strong>
                    <p>
                      Task #{item.taskId}: {personName(item.requesterId)} →{" "}
                      {personName(item.targetId)} · awaiting response
                    </p>
                  </div>
                  {item.targetId === userId && (
                    <div className="record-actions">
                      <button
                        className="button button-primary small-button"
                        disabled={saving}
                        onClick={() =>
                          void run(
                            () =>
                              respondRequest.mutateAsync({
                                familyId,
                                requestId: item.id,
                                accept: true,
                              }),
                            "Accepted. The task is now assigned to you."
                          )
                        }
                      >
                        Accept
                      </button>
                      <button
                        className="button button-subtle small-button"
                        disabled={saving}
                        onClick={() =>
                          void run(
                            () =>
                              respondRequest.mutateAsync({
                                familyId,
                                requestId: item.id,
                                accept: false,
                              }),
                            "Request declined."
                          )
                        }
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </article>
              ))
            )}
            {(requests.data ?? [])
              .filter(item => item.status !== "pending")
              .slice(0, 8)
              .map(item => (
                <div className="phase2-history" key={item.id}>
                  {item.kind} · task #{item.taskId} · {item.status}
                </div>
              ))}
          </>
        )}
      </section>

      <section className="panel full-panel phase2-panel">
        <h2>Planned absences</h2>
        <p className="form-hint">
          Records who is away and which open tasks overlap. Adding an absence
          never changes task assignments.
        </p>
        {absences.isLoading ? (
          <p className="loading-state">Loading planned absences…</p>
        ) : absences.error ? (
          <p className="data-error" role="alert">
            Absences could not be loaded.{" "}
            <button
              className="text-action"
              onClick={() => void absences.refetch()}
            >
              Try again
            </button>
          </p>
        ) : (
          <>
            {canWrite && (
              <form
                className="phase2-inline-form"
                onSubmit={event => {
                  event.preventDefault();
                  const d = new FormData(event.currentTarget);
                  const input = {
                    familyId,
                    memberId: Number(d.get("memberId")),
                    startDate: String(d.get("startDate")),
                    endDate: String(d.get("endDate")),
                    note: String(d.get("note") || "") || null,
                  };
                  void run(
                    () => createAbsence.mutateAsync(input),
                    "Absence saved. Task assignments were not changed."
                  );
                  event.currentTarget.reset();
                }}
              >
                <label>
                  Member
                  <select name="memberId" required defaultValue="">
                    {people.map(person => (
                      <option key={person.userId} value={person.userId}>
                        {person.name || "Family member"}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  From
                  <input type="date" name="startDate" required />
                </label>
                <label>
                  Through
                  <input type="date" name="endDate" required />
                </label>
                <label>
                  Note
                  <input name="note" maxLength={1000} placeholder="Optional" />
                </label>
                <button
                  className="button button-primary"
                  disabled={saving || !people.length}
                >
                  Save absence
                </button>
              </form>
            )}
            {(absences.data ?? []).length === 0 ? (
              <p className="phase2-empty">
                No planned absences have been recorded.
              </p>
            ) : (
              (absences.data ?? []).map(row => (
                <article className="phase2-record" key={row.id}>
                  <div>
                    <strong>
                      {personName(row.memberId)} · {row.startDate} to{" "}
                      {row.endDate}
                    </strong>
                    {row.note && <p>{row.note}</p>}
                    <small>
                      {row.affectedTasks.length
                        ? `${row.affectedTasks.length} affected open task(s): ${row.affectedTasks.map(task => task.title).join(", ")}`
                        : "No matching open tasks"}
                    </small>
                  </div>
                </article>
              ))
            )}
          </>
        )}
      </section>

      <section className="panel full-panel phase2-panel">
        <h2>Family audit history</h2>
        <p className="form-hint">
          Read-only record of actor, time and previous/new values. Audit entries
          cannot be edited or deleted through this API.
        </p>
        {audit.isLoading ? (
          <p className="loading-state">Loading audit history…</p>
        ) : audit.error ? (
          <p className="data-error" role="alert">
            Audit history could not be loaded.{" "}
            <button
              className="text-action"
              onClick={() => void audit.refetch()}
            >
              Try again
            </button>
          </p>
        ) : (audit.data ?? []).length === 0 ? (
          <p className="phase2-empty">No audit entries yet.</p>
        ) : (
          (audit.data ?? []).map(row => (
            <article className="phase2-record audit-record" key={row.id}>
              <div>
                <strong>
                  {row.action} · {row.resourceType} #{row.resourceId ?? "—"}
                </strong>
                <small>
                  {personName(row.actorId)} ·{" "}
                  {new Date(row.createdAt).toLocaleString()}
                </small>
                <details>
                  <summary>Before / after</summary>
                  <pre>
                    {JSON.stringify(
                      { previous: row.previousValues, next: row.newValues },
                      null,
                      2
                    )}
                  </pre>
                </details>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

export function HandoffPanel({
  familyId,
  canWrite,
}: {
  familyId: number;
  canWrite: boolean;
}) {
  const events = trpc.care.events.list.useQuery({ familyId });
  const tasks = trpc.care.tasks.list.useQuery({ familyId });
  const members = trpc.care.families.members.useQuery({ familyId });
  const handoffs = trpc.care.handoffs.list.useQuery({ familyId });
  const utils = trpc.useUtils();
  const createHandoff = trpc.care.handoffs.create.useMutation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const run = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const input = {
      familyId,
      eventId: Number(data.get("eventId")),
      recipientId: Number(data.get("recipientId")),
      context: String(data.get("context") || ""),
      pendingTaskIds: data.getAll("pendingTaskIds").map(Number),
    };
    try {
      await createHandoff.mutateAsync(input);
      await Promise.all([
        utils.care.handoffs.list.invalidate({ familyId }),
        utils.care.audit.list.invalidate({ familyId }),
      ]);
      form.reset();
      toast.success("Visit handoff saved for the selected recipient.");
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };
  const visits = (events.data ?? []).filter(event => event.kind === "visit");
  const openTasks = (tasks.data ?? []).filter(
    task => task.status !== "completed"
  );
  const people = members.data ?? [];
  const name = (id: number) =>
    people.find(person => person.userId === id)?.name || "Family member";
  return (
    <section className="panel full-panel phase2-panel">
      <h2>After-visit handoff</h2>
      <p className="form-hint">
        Share visit context and pending tasks with one chosen family member.
        This is in-app only; no external notifications are sent.
      </p>
      {events.isLoading ||
      tasks.isLoading ||
      members.isLoading ||
      handoffs.isLoading ? (
        <p className="loading-state">Loading handoff details…</p>
      ) : events.error || tasks.error || members.error || handoffs.error ? (
        <p className="data-error" role="alert">
          Handoff details could not be loaded.{" "}
          <button
            className="text-action"
            onClick={() => {
              void events.refetch();
              void tasks.refetch();
              void members.refetch();
              void handoffs.refetch();
            }}
          >
            Try again
          </button>
        </p>
      ) : (
        <>
          {canWrite && (
            <form
              className="shared-form phase2-handoff-form"
              onSubmit={event => void run(event)}
            >
              <label>
                Visit
                <select name="eventId" required defaultValue="">
                  <option value="" disabled>
                    Select a family visit
                  </option>
                  {visits.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.title} ·{" "}
                      {new Date(item.startsAt).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Recipient
                <select name="recipientId" required defaultValue="">
                  <option value="" disabled>
                    Select a family member
                  </option>
                  {people.map(person => (
                    <option key={person.userId} value={person.userId}>
                      {person.name || "Family member"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Context for the next caregiver
                <textarea
                  name="context"
                  required
                  minLength={1}
                  maxLength={8000}
                  rows={4}
                  placeholder="What should the recipient know after this visit?"
                />
              </label>
              <fieldset>
                <legend>Pending tasks to include</legend>
                {openTasks.length ? (
                  openTasks.map(task => (
                    <label className="phase2-checkbox" key={task.id}>
                      <input
                        type="checkbox"
                        name="pendingTaskIds"
                        value={task.id}
                      />
                      {task.title}
                    </label>
                  ))
                ) : (
                  <small>No pending tasks.</small>
                )}
              </fieldset>
              <button
                className="button button-primary"
                disabled={saving || !visits.length || !people.length}
              >
                Save handoff
              </button>
              {error && (
                <p className="data-error" role="alert">
                  {error}
                </p>
              )}
            </form>
          )}
          {!visits.length && (
            <p className="phase2-empty">
              No family visits yet. Add a visit on the calendar before creating
              a handoff.
            </p>
          )}
          {(handoffs.data ?? []).length === 0 ? (
            <p className="phase2-empty">No visit handoffs recorded.</p>
          ) : (
            (handoffs.data ?? []).map(item => (
              <article className="phase2-record" key={item.id}>
                <div>
                  <strong>
                    For {name(item.recipientId)} ·{" "}
                    {new Date(item.createdAt).toLocaleString()}
                  </strong>
                  <p>{item.context}</p>
                  <small>
                    Pending tasks:{" "}
                    {item.pendingTasks.length
                      ? item.pendingTasks.map(task => task.title).join(", ")
                      : "None still open"}
                  </small>
                </div>
              </article>
            ))
          )}
        </>
      )}
    </section>
  );
}
