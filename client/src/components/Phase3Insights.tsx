import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";

const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const defaultRange = () => {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  return { start: localDateKey(start), end: localDateKey(end) };
};

export default function Phase3Insights({ familyId }: { familyId: number }) {
  const [range, setRange] = useState(defaultRange);
  const valid =
    range.start <= range.end &&
    Date.parse(`${range.end}T00:00:00Z`) -
      Date.parse(`${range.start}T00:00:00Z`) <=
      6 * 86400000;
  const input = { familyId, startDate: range.start, endDate: range.end };
  const workload = trpc.care.phase3.workload.useQuery(input, {
    enabled: valid,
    retry: false,
  });
  const summary = trpc.care.phase3.weeklySummary.useQuery(input, {
    enabled: valid,
    retry: false,
  });
  const digest = trpc.care.phase3.digestPreference.useQuery({ familyId });
  const plan = trpc.care.phase3.planStatus.useQuery({ familyId });
  const utils = trpc.useUtils();
  const savePreference = trpc.care.phase3.setDigestPreference.useMutation({
    onSuccess: async () => {
      await utils.care.phase3.digestPreference.invalidate({ familyId });
    },
  });
  const empty = useMemo(
    () =>
      !workload.data?.members.some(
        row => row.completed + row.upcoming + row.overdue > 0
      ),
    [workload.data]
  );
  return (
    <section className="panel phase3-panel" aria-labelledby="phase3-title">
      <div className="phase3-heading">
        <div>
          <span className="eyebrow">FAMILY COORDINATION</span>
          <h2 id="phase3-title">Care workload & weekly snapshot</h2>
          <p>
            Use these counts to start a conversation—not to compare or judge
            people.
          </p>
        </div>
        <div className="phase3-dates">
          <label>
            From
            <input
              aria-label="Report start date"
              type="date"
              value={range.start}
              onChange={event =>
                setRange(v => ({ ...v, start: event.target.value }))
              }
            />
          </label>
          <label>
            Through
            <input
              aria-label="Report end date"
              type="date"
              value={range.end}
              onChange={event =>
                setRange(v => ({ ...v, end: event.target.value }))
              }
            />
          </label>
        </div>
      </div>
      {!valid && (
        <p className="phase3-error" role="alert">
          Choose a valid range of up to 7 days for this weekly view.
        </p>
      )}
      <div className="phase3-grid">
        <div className="phase3-card">
          <h3>Workload distribution</h3>
          <p className="phase3-caption">
            Completed, upcoming and overdue tasks; estimated totals appear only
            when entered.
          </p>
          {workload.isLoading ? (
            <p className="phase3-state">Loading workload…</p>
          ) : workload.error ? (
            <p className="phase3-error" role="alert">
              Could not load the workload report. {workload.error.message}
            </p>
          ) : empty ? (
            <p className="phase3-state">No tasks in this date range.</p>
          ) : (
            <div className="phase3-table-wrap">
              <table className="phase3-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Done</th>
                    <th>Upcoming</th>
                    <th>Overdue</th>
                    <th>Est. min</th>
                  </tr>
                </thead>
                <tbody>
                  {workload.data?.members.map(person => (
                    <tr key={person.userId ?? "unassigned"}>
                      <th scope="row">{person.name}</th>
                      <td>{person.completed}</td>
                      <td>{person.upcoming}</td>
                      <td>{person.overdue}</td>
                      <td>{person.estimatedMinutesTotal || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {workload.data && (
            <p className="phase3-caveat">{workload.data.caveat}</p>
          )}
        </div>
        <div className="phase3-card">
          <h3>Optional weekly summary</h3>
          <p className="phase3-caption">
            A private, on-screen summary. No notes or medication details are
            included.
          </p>
          {summary.isLoading ? (
            <p className="phase3-state">Loading weekly summary…</p>
          ) : summary.error ? (
            <p className="phase3-error" role="alert">
              Could not load the summary. {summary.error.message}
            </p>
          ) : summary.data ? (
            <>
              <dl className="phase3-counts">
                <div>
                  <dt>Completed tasks</dt>
                  <dd>{summary.data.completedTasks}</dd>
                </div>
                <div>
                  <dt>Pending tasks</dt>
                  <dd>{summary.data.pendingTasks}</dd>
                </div>
                <div>
                  <dt>Unassigned</dt>
                  <dd>{summary.data.unassignedTasks}</dd>
                </div>
                <div>
                  <dt>Pending help / collaboration</dt>
                  <dd>{summary.data.pendingHelpRequests}</dd>
                </div>
              </dl>
              <h4>Family events</h4>
              {summary.data.events.length ? (
                <ul className="phase3-events">
                  {summary.data.events.map((event, index) => (
                    <li key={`${event.startsAt}-${index}`}>
                      {event.title} ·{" "}
                      {new Date(event.startsAt).toLocaleString()}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="phase3-state">No family events in this range.</p>
              )}
              <p className="phase3-caveat">{summary.data.privacy}</p>
            </>
          ) : (
            <p className="phase3-state">No summary available for this range.</p>
          )}
        </div>
      </div>
      <div className="phase3-footer">
        <div>
          <strong>Weekly digest preference</strong>
          <p>
            Preference only—email delivery and scheduling are not configured.
          </p>
          {digest.isLoading ? (
            <span className="phase3-state">Loading preference…</span>
          ) : digest.error ? (
            <span className="phase3-error" role="alert">
              Could not load preference.
            </span>
          ) : (
            <label className="phase3-toggle">
              <input
                type="checkbox"
                checked={digest.data?.enabled ?? false}
                disabled={savePreference.isPending}
                onChange={event =>
                  savePreference.mutate({
                    familyId,
                    enabled: event.target.checked,
                  })
                }
              />
              {digest.data?.enabled
                ? "Opted in (preference only)"
                : "Off by default — opt in if wanted"}
            </label>
          )}
          {savePreference.error && (
            <p className="phase3-error" role="alert">
              Preference could not be saved: {savePreference.error.message}
            </p>
          )}
        </div>
        <div className="phase3-plan">
          <strong>Plan: {plan.data?.plan ?? "Free"}</strong>
          <p>
            {plan.data?.message ??
              "Core care and safety features remain available on Free. Premium is not available."}
          </p>
          <small>
            Core care, safety features and family data access are not gated by
            plan.
          </small>
        </div>
      </div>
    </section>
  );
}
