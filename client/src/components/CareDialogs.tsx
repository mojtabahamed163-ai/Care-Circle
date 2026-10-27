import { X } from "lucide-react";

export type FamilyMemberOption = {
  userId: number;
  name: string | null;
  role: string;
};
export type TaskFormItem = {
  id: number;
  title: string;
  description: string | null;
  dueAt: Date | null;
  priority: "low" | "medium" | "high";
  assigneeId: number | null;
  status: "new" | "in_progress" | "completed";
  recurrence: "none" | "daily" | "weekly" | "monthly";
  notes: string | null;
};
export type MedicationFormItem = {
  id: number;
  name: string;
  dose: string;
  schedule: string;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  assigneeId: number | null;
  active: boolean;
};
export type CareDialogMode =
  | { kind: "task"; item?: TaskFormItem }
  | { kind: "medication"; item?: MedicationFormItem }
  | { kind: "event" }
  | { kind: "note" }
  | { kind: "invite" }
  | { kind: "dose"; medicationId: number; medicationName: string };

type Props = {
  mode: CareDialogMode | null;
  members: FamilyMemberOption[];
  busy?: boolean;
  onClose: () => void;
  onSubmit: (
    kind: CareDialogMode["kind"],
    values: Record<string, string>
  ) => void;
};

function localDateTime(date?: Date | null) {
  if (!date) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function MemberSelect({
  members,
  initial,
  label = "Caregiver",
}: {
  members: FamilyMemberOption[];
  initial?: number | null;
  label?: string;
}) {
  return (
    <Field label={label}>
      <select name="assigneeId" defaultValue={initial ?? ""}>
        <option value="">Unassigned</option>
        {members.map(member => (
          <option value={member.userId} key={member.userId}>
            {member.name || "Family member"}
          </option>
        ))}
      </select>
    </Field>
  );
}

export default function CareDialog({
  mode,
  members,
  busy = false,
  onClose,
  onSubmit,
}: Props) {
  if (!mode) return null;
  const title =
    mode.kind === "task"
      ? mode.item
        ? "Update task"
        : "Add a family task"
      : mode.kind === "medication"
        ? mode.item
          ? "Update medication"
          : "Add medication"
        : mode.kind === "event"
          ? "Add an appointment or visit"
          : mode.kind === "note"
            ? "Add to the care journal"
            : mode.kind === "invite"
              ? "Invite a family member"
              : `Confirm ${mode.medicationName}`;

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">CARE CIRCLE</span>
            <h2 id="modal-title">{title}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={19} />
          </button>
        </div>
        <form
          className="record-form"
          onSubmit={event => {
            event.preventDefault();
            const form = event.currentTarget;
            const values = Object.fromEntries(new FormData(form).entries());
            onSubmit(
              mode.kind,
              Object.fromEntries(
                Object.entries(values).map(([key, value]) => [
                  key,
                  String(value),
                ])
              )
            );
          }}
        >
          {mode.kind === "task" && (
            <>
              <Field label="Task title">
                <input
                  required
                  maxLength={180}
                  name="title"
                  placeholder="e.g. Pick up the prescription"
                  defaultValue={mode.item?.title ?? ""}
                />
              </Field>
              <Field label="Details">
                <textarea
                  name="description"
                  rows={2}
                  maxLength={5000}
                  placeholder="Anything the next person should know"
                  defaultValue={mode.item?.description ?? ""}
                />
              </Field>
              <div className="form-row">
                <Field label="Due date & time">
                  <input
                    name="dueAt"
                    type="datetime-local"
                    defaultValue={localDateTime(mode.item?.dueAt)}
                  />
                </Field>
                <Field label="Priority">
                  <select
                    name="priority"
                    defaultValue={mode.item?.priority ?? "medium"}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Normal</option>
                    <option value="high">High</option>
                  </select>
                </Field>
              </div>
              <div className="form-row">
                <MemberSelect
                  members={members}
                  initial={mode.item?.assigneeId}
                />
                <Field label="Repeat">
                  <select
                    name="recurrence"
                    defaultValue={mode.item?.recurrence ?? "none"}
                  >
                    <option value="none">Does not repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </Field>
              </div>
              {mode.item && (
                <Field label="Status">
                  <select name="status" defaultValue={mode.item.status}>
                    <option value="new">New</option>
                    <option value="in_progress">In progress</option>
                    <option value="completed">Completed</option>
                  </select>
                </Field>
              )}
              <Field label="Notes">
                <textarea
                  name="notes"
                  rows={2}
                  maxLength={5000}
                  placeholder="Optional handoff note"
                  defaultValue={mode.item?.notes ?? ""}
                />
              </Field>
            </>
          )}
          {mode.kind === "medication" && (
            <>
              <div className="medical-note">
                <strong>
                  Use the dose exactly as the clinician prescribed.
                </strong>
                <span>
                  Care Circle records family confirmations; it does not give
                  medical advice.
                </span>
              </div>
              <Field label="Medication name">
                <input
                  required
                  name="name"
                  maxLength={180}
                  placeholder="Medication name"
                  defaultValue={mode.item?.name ?? ""}
                />
              </Field>
              <Field label="Dose as prescribed">
                <input
                  required
                  name="dose"
                  maxLength={180}
                  placeholder="e.g. 1 tablet"
                  defaultValue={mode.item?.dose ?? ""}
                />
              </Field>
              <Field label="Reminder schedule">
                <input
                  required
                  name="schedule"
                  maxLength={240}
                  placeholder="e.g. Daily · 8:00 AM"
                  defaultValue={mode.item?.schedule ?? ""}
                />
              </Field>
              <div className="form-row">
                <Field label="Start date">
                  <input
                    type="date"
                    name="startDate"
                    defaultValue={mode.item?.startDate ?? ""}
                  />
                </Field>
                <Field label="End date (optional)">
                  <input
                    type="date"
                    name="endDate"
                    defaultValue={mode.item?.endDate ?? ""}
                  />
                </Field>
              </div>
              <MemberSelect
                members={members}
                initial={mode.item?.assigneeId}
                label="Family point person"
              />
              <Field label="Notes">
                <textarea
                  name="notes"
                  rows={2}
                  maxLength={5000}
                  placeholder="Optional note from the family"
                  defaultValue={mode.item?.notes ?? ""}
                />
              </Field>
              {mode.item && (
                <label className="check-field">
                  <input
                    name="active"
                    type="checkbox"
                    defaultChecked={mode.item.active}
                  />
                  <span>Medication is active on the family list</span>
                </label>
              )}
            </>
          )}
          {mode.kind === "event" && (
            <>
              <Field label="Event name">
                <input
                  required
                  name="title"
                  maxLength={180}
                  placeholder="e.g. Dr. Patel — follow-up"
                />
              </Field>
              <div className="form-row">
                <Field label="Type">
                  <select name="kind" defaultValue="appointment">
                    <option value="appointment">Medical appointment</option>
                    <option value="visit">Family visit</option>
                  </select>
                </Field>
                <Field label="Date & time">
                  <input required name="startsAt" type="datetime-local" />
                </Field>
              </div>
              <Field label="Location">
                <input
                  name="location"
                  maxLength={240}
                  placeholder="Clinic or home address"
                />
              </Field>
              <MemberSelect members={members} label="Person accompanying" />
              <Field label="Reminder preference">
                <select name="reminderMinutes" defaultValue="60">
                  <option value="0">No reminder set</option>
                  <option value="15">15 minutes before</option>
                  <option value="30">30 minutes before</option>
                  <option value="60">1 hour before</option>
                  <option value="1440">1 day before</option>
                </select>
              </Field>
              <Field label="Questions for the clinician">
                <textarea
                  name="questions"
                  rows={2}
                  maxLength={5000}
                  placeholder="Questions to bring to the visit"
                />
              </Field>
              <Field label="Visit notes (optional)">
                <textarea
                  name="visitNotes"
                  rows={2}
                  maxLength={5000}
                  placeholder="Add notes after the appointment"
                />
              </Field>
            </>
          )}
          {mode.kind === "note" && (
            <>
              <Field label="Entry type">
                <select name="kind" defaultValue="update">
                  <option value="update">Care update</option>
                  <option value="visit_note">Visit note</option>
                  <option value="question">Question for the doctor</option>
                  <option value="handoff">Care handoff</option>
                  <option value="need">Family need</option>
                </select>
              </Field>
              <Field label="What should the family know?">
                <textarea
                  required
                  name="body"
                  rows={5}
                  maxLength={8000}
                  placeholder="Share a concise update for the next caregiver…"
                />
              </Field>
              <label className="check-field">
                <input type="checkbox" name="isConfirmedFact" />
                <span>
                  This is a confirmed fact (not a personal observation)
                </span>
              </label>
              <p className="form-hint">
                Keep personal observations distinct from confirmed information.
                This journal is not a medical record or diagnosis.
              </p>
            </>
          )}
          {mode.kind === "invite" && (
            <>
              <p className="form-intro">
                Create a secure, revocable invitation link. No email will be
                sent from this app; share the link with your family member
                yourself. It expires in 7 days.
              </p>
              <Field label="Invitee email (optional; access will be limited to this email)">
                <input
                  type="email"
                  name="email"
                  maxLength={320}
                  placeholder="name@example.com"
                />
              </Field>
              <Field label="Family role">
                <select name="role" defaultValue="caregiver">
                  <option value="caregiver">Caregiver — coordinate care</option>
                  <option value="coordinator">
                    Coordinator — manage family access
                  </option>
                  <option value="viewer">Viewer — read-only access</option>
                </select>
              </Field>
            </>
          )}
          {mode.kind === "dose" && (
            <>
              <div className="medical-note">
                <strong>Record only what you personally confirmed.</strong>
                <span>
                  Opening a reminder is not a confirmation. The app does not
                  verify whether a dose was given.
                </span>
              </div>
              <Field label="Follow-up note (optional)">
                <textarea
                  name="note"
                  rows={3}
                  maxLength={2000}
                  placeholder="Add a note for the family if follow-up is needed"
                />
              </Field>
            </>
          )}
          <div className="modal-actions">
            <button
              className="button button-subtle"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              type="submit"
              disabled={busy}
            >
              {busy
                ? "Saving…"
                : mode.kind === "dose"
                  ? "Record confirmation"
                  : mode.kind === "invite"
                    ? "Create invitation link"
                    : mode.kind === "task" && mode.item
                      ? "Save task"
                      : mode.kind === "medication" && mode.item
                        ? "Save medication"
                        : "Save"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
