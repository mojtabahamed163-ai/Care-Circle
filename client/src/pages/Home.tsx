import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  ContactRound,
  ShoppingBasket,
  Clock3,
  Download,
  Heart,
  Home as HomeIcon,
  LogOut,
  Menu,
  Pill,
  Plus,
  ShieldCheck,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { startLogin } from "@/const";
import CareDialog, {
  type CareDialogMode,
  type FamilyMemberOption,
} from "@/components/CareDialogs";
import { CollaborationPanels, HandoffPanel } from "@/components/Phase2Collaboration";
import Phase3Insights from "@/components/Phase3Insights";
import { canCoordinateRole, canWriteRole } from "@/lib/care-permissions";
import { trpc } from "@/lib/trpc";
import {
  canConfirmDoseAt,
  dateKeyInZone,
  isValidTimeZone,
} from "@shared/timezone";

type Tab =
  | "home"
  | "tasks"
  | "calendar"
  | "medications"
  | "journal"
  | "needs"
  | "contacts"
  | "family"
  | "privacy";
const tabTitles: Record<Tab, string> = {
  home: "Overview",
  tasks: "Family tasks",
  calendar: "Calendar",
  medications: "Medications",
  journal: "Care journal",
  needs: "Household needs",
  contacts: "Important contacts",
  family: "Family circle",
  privacy: "Privacy & safety",
};
const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const shortDate = (value: Date | string | null | undefined) =>
  value
    ? new Date(value).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "No due date";
const dateTime = (value: Date | string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Time not set";
const eventTimeZone = (timeZone: string | null) => {
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return timeZone && isValidTimeZone(timeZone)
    ? timeZone
    : isValidTimeZone(deviceZone)
      ? deviceZone
      : "UTC";
};
const eventDateTime = (value: Date | string, timeZone: string | null) => {
  const parsed = new Date(value);
  const zone = eventTimeZone(timeZone);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
    timeZoneName: "short",
  }).format(parsed);
};
const eventLocalDate = (value: Date | string, timeZone: string | null) =>
  dateKeyInZone(new Date(value), eventTimeZone(timeZone));
const reminderPreference = (minutes: number) => {
  if (minutes === 0) return "No reminder";
  if (minutes === 60) return "1 hour before";
  if (minutes === 1440) return "1 day before";
  if (minutes > 60 && minutes % 60 === 0) return `${minutes / 60} hours before`;
  return `${minutes} minutes before`;
};
const initials = (name?: string | null) =>
  (name || "Family member")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join("") || "F";

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-lockup ${compact ? "brand-compact" : ""}`}>
      <span className="brand-symbol">
        <i />
        <b />
      </span>
      <span className="brand-type">
        <strong>care circle</strong>
        <small>family care, shared</small>
      </span>
    </div>
  );
}
function Spinner() {
  return (
    <div className="loading-state">
      <span className="spinner" />
      <span>Getting your family space ready…</span>
    </div>
  );
}
function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={21} />
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
function Avatar({ name }: { name?: string | null }) {
  return <span className="avatar">{initials(name)}</span>;
}

export default function Home() {
  const [path, setPath] = useLocation();
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [calendarRange, setCalendarRange] = useState<"day" | "week">("week");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const value = window.localStorage.getItem("care-circle-family");
    return value ? Number(value) || null : null;
  });
  const [dialog, setDialog] = useState<CareDialogMode | null>(null);
  const [needFormOpen, setNeedFormOpen] = useState(false);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [editingNeedId, setEditingNeedId] = useState<number | null>(null);
  const [editingContactId, setEditingContactId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [transferTargetId, setTransferTargetId] = useState<number | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  const me = trpc.auth.me.useQuery();
  const isInvitationPath = path.startsWith("/invite/");
  const invitationToken = isInvitationPath
    ? path.slice("/invite/".length).split("/")[0] || ""
    : "";
  const invitation = trpc.care.invitations.preview.useQuery(
    { token: invitationToken },
    { enabled: invitationToken.length >= 32, retry: false }
  );
  const families = trpc.care.families.list.useQuery(undefined, {
    enabled: !!me.data,
  });
  const familyId = selectedId ?? families.data?.[0]?.id ?? 0;
  const currentFamily =
    families.data?.find(family => family.id === familyId) ?? families.data?.[0];
  const enabled = !!me.data && familyId > 0;
  const tasks = trpc.care.tasks.list.useQuery({ familyId }, { enabled });
  const medications = trpc.care.medications.list.useQuery(
    { familyId },
    { enabled }
  );
  const events = trpc.care.events.list.useQuery({ familyId }, { enabled });
  const notes = trpc.care.notes.list.useQuery({ familyId }, { enabled });
  const needs = trpc.care.householdNeeds.list.useQuery(
    { familyId },
    { enabled }
  );
  const contacts = trpc.care.importantContacts.list.useQuery(
    { familyId },
    { enabled }
  );
  const notificationPreferences = trpc.care.phase3.notificationPreferences.useQuery({ familyId }, { enabled });
  const notificationInbox = trpc.care.phase3.inbox.useQuery({ familyId }, { enabled, refetchInterval: 30_000 });
  const members = trpc.care.families.members.useQuery(
    { familyId },
    { enabled }
  );
  const invitations = trpc.care.families.invitations.useQuery(
    { familyId },
    {
      enabled:
        enabled && ["owner", "coordinator"].includes(currentFamily?.role ?? ""),
    }
  );
  const utils = trpc.useUtils();

  useEffect(() => {
    if (
      families.data?.length &&
      !families.data.some(family => family.id === selectedId)
    )
      setSelectedId(families.data[0].id);
  }, [families.data, selectedId]);
  useEffect(() => {
    if (selectedId)
      window.localStorage.setItem("care-circle-family", String(selectedId));
  }, [selectedId]);
  useEffect(() => {
    if (!me.data || path !== "/") return;
    const pendingPath = window.sessionStorage.getItem(
      "care-circle-pending-invite"
    );
    if (pendingPath?.startsWith("/invite/")) {
      window.sessionStorage.removeItem("care-circle-pending-invite");
      setPath(pendingPath);
    }
  }, [me.data, path, setPath]);

  const refresh = async () => {
    await Promise.all([
      utils.care.families.list.invalidate(),
      ...(familyId
        ? [
            utils.care.tasks.list.invalidate({ familyId }),
            utils.care.medications.list.invalidate({
              familyId,
            }),
            utils.care.events.list.invalidate({ familyId }),
            utils.care.notes.list.invalidate({ familyId }),
            utils.care.householdNeeds.list.invalidate({ familyId }),
            utils.care.importantContacts.list.invalidate({ familyId }),
            utils.care.families.members.invalidate({ familyId }),
            utils.care.families.invitations.invalidate({ familyId }),
          ]
        : []),
    ]);
  };
  const showError = (error: unknown) =>
    toast.error(
      error instanceof Error
        ? error.message
        : "That change could not be saved. Please try again."
    );
  const createFamily = trpc.care.families.create.useMutation();
  const exportFamily = trpc.care.families.export.useMutation();
  const createTask = trpc.care.tasks.create.useMutation();
  const updateTask = trpc.care.tasks.update.useMutation();
  const deleteTask = trpc.care.tasks.delete.useMutation();
  const createMedication = trpc.care.medications.create.useMutation();
  const updateMedication = trpc.care.medications.update.useMutation();
  const confirmDose = trpc.care.medications.confirm.useMutation();
  const setNotificationPreferences = trpc.care.phase3.setNotificationPreferences.useMutation();
  const markNotificationRead = trpc.care.phase3.markNotificationRead.useMutation();
  const createEvent = trpc.care.events.create.useMutation();
  const updateEvent = trpc.care.events.update.useMutation();
  const deleteEvent = trpc.care.events.delete.useMutation();
  const createNote = trpc.care.notes.create.useMutation();
  const createNeed = trpc.care.householdNeeds.create.useMutation();
  const updateNeed = trpc.care.householdNeeds.update.useMutation();
  const deleteNeed = trpc.care.householdNeeds.delete.useMutation();
  const createContact = trpc.care.importantContacts.create.useMutation();
  const updateContact = trpc.care.importantContacts.update.useMutation();
  const deleteContact = trpc.care.importantContacts.delete.useMutation();
  const createInvitation = trpc.care.families.invite.useMutation();
  const acceptInvitation = trpc.care.invitations.accept.useMutation();
  const declineInvitation = trpc.care.invitations.decline.useMutation();
  const revokeInvitation = trpc.care.families.revokeInvitation.useMutation();
  const changeRole = trpc.care.families.changeRole.useMutation();
  const transferOwnership = trpc.care.families.transferOwnership.useMutation();
  const removeMember = trpc.care.families.removeMember.useMutation();
  const leaveFamily = trpc.care.families.leave.useMutation();
  const logout = trpc.auth.logout.useMutation();
  const deleteAccount = trpc.auth.deleteAccount.useMutation();

  const taskRows = tasks.data ?? [];
  const medicationRows = medications.data ?? [];
  const eventRows = events.data ?? [];
  const noteRows = notes.data ?? [];
  const needRows = needs.data ?? [];
  const contactRows = contacts.data ?? [];
  const memberRows = members.data ?? [];
  const memberOptions: FamilyMemberOption[] = memberRows.map(member => ({
    userId: member.userId,
    name: member.name,
    role: member.role,
  }));
  const isOverdue = (task: (typeof taskRows)[number]) =>
    !!task.dueAt && new Date(task.dueAt) < now && task.status !== "completed";
  const overdueCount = taskRows.filter(isOverdue).length;
  const dueTodayCount = taskRows.filter(
    task =>
      task.dueAt &&
      new Date(task.dueAt).toDateString() === now.toDateString() &&
      task.status !== "completed"
  ).length;
  const unassignedCount = taskRows.filter(
    task => !task.assigneeId && task.status !== "completed"
  ).length;
  const unconfirmedCount = medicationRows.reduce(
    (sum, med) => sum + med.doses.filter(dose => !dose.confirmation).length,
    0
  );
  const nextEvent = eventRows.find(event => new Date(event.startsAt) >= now);
  const queryError =
    tasks.error ||
    medications.error ||
    events.error ||
    notes.error ||
    needs.error ||
    contacts.error ||
    members.error;

  const signIn = () => {
    if (isInvitationPath)
      window.sessionStorage.setItem("care-circle-pending-invite", path);
    try {
      startLogin();
    } catch (error) {
      showError(error);
    }
  };
  const onFamilyCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (name.length < 2) return toast.error("Please enter a family name.");
    try {
      const family = await createFamily.mutateAsync({ name });
      setSelectedId(family.id);
      await utils.care.families.list.invalidate();
      toast.success("Your family space is ready.");
    } catch (error) {
      showError(error);
    }
  };

  const downloadFamilyExport = async () => {
    try {
      const data = await exportFamily.mutateAsync({ familyId });
      const file = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      const familySlug = (currentFamily?.name || "family")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      link.href = url;
      link.download = `care-circle-${familySlug || "family"}-${todayKey()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("A JSON export for this family was downloaded.");
    } catch (error) {
      showError(error);
    }
  };

  const submitDialog = async (
    kind: CareDialogMode["kind"],
    values: Record<string, string>
  ) => {
    if (!familyId && kind !== "invite") return;
    setBusy(true);
    const assignment = values.assigneeId ? Number(values.assigneeId) : null;
    try {
      if (kind === "task") {
        const mode = dialog?.kind === "task" ? dialog : null;
        const fields = {
          familyId,
          title: values.title.trim(),
          description: values.description || null,
          dueAt: values.dueAt ? new Date(values.dueAt) : null,
          priority: values.priority as "low" | "medium" | "high",
          assigneeId: assignment,
          recurrence: values.recurrence as
            | "none"
            | "daily"
            | "weekly"
            | "monthly",
          notes: values.notes || null,
          estimatedMinutes: values.estimatedMinutes ? Number(values.estimatedMinutes) : null,
        };
        if (mode?.item)
          await updateTask.mutateAsync({
            ...fields,
            taskId: mode.item.id,
            status: (values.status || mode.item.status) as
              | "new"
              | "in_progress"
              | "completed",
          });
        else await createTask.mutateAsync(fields);
        toast.success(
          mode?.item ? "Task updated." : "Task added to your family list."
        );
      } else if (kind === "medication") {
        const mode = dialog?.kind === "medication" ? dialog : null;
        const fields = {
          familyId,
          name: values.name.trim(),
          dose: values.dose.trim(),
          schedule: values.schedule.trim(),
          doseTimes: values.doseTimes.trim(),
          timeZone: values.timeZone.trim(),
          startDate: values.startDate || null,
          endDate: values.endDate || null,
          notes: values.notes || null,
          assigneeId: assignment,
          escalationRecipientId: values.escalationRecipientId ? Number(values.escalationRecipientId) : null,
        };
        if (mode?.item)
          await updateMedication.mutateAsync({
            ...fields,
            medicationId: mode.item.id,
            active: values.active === "on",
          });
        else await createMedication.mutateAsync(fields);
        toast.success(
          mode?.item
            ? "Medication details updated."
            : "Medication added to the family list."
        );
      } else if (kind === "event") {
        const eventMode = dialog?.kind === "event" ? dialog : null;
        const fields = {
          familyId,
          title: values.title.trim(),
          kind: values.kind as "appointment" | "visit",
          startsAtLocal: values.startsAtLocal,
          timeZone: values.timeZone.trim(),
          location: values.location || null,
          escortId: assignment,
          reminderMinutes: Number(values.reminderMinutes),
          questions: values.questions || null,
          visitNotes: values.visitNotes || null,
        };
        if (eventMode?.item) {
          await updateEvent.mutateAsync({
            ...fields,
            eventId: eventMode.item.id,
          });
          toast.success("Appointment or visit updated.");
        } else {
          await createEvent.mutateAsync(fields);
          toast.success("Appointment added to the family calendar.");
        }
      } else if (kind === "note") {
        await createNote.mutateAsync({
          familyId,
          kind: values.kind as
            | "update"
            | "visit_note"
            | "question"
            | "handoff"
            | "need",
          body: values.body.trim(),
          isConfirmedFact: values.isConfirmedFact === "on",
        });
        toast.success("Journal entry shared with your family.");
      } else if (kind === "invite") {
        const result = await createInvitation.mutateAsync({
          familyId,
          email: values.email.trim() || null,
          role: values.role as "coordinator" | "caregiver" | "viewer",
        });
        const link = `${window.location.origin}/invite/${result.token}`;
        setInviteLink(link);
        try {
          await navigator.clipboard.writeText(link);
          toast.success(
            "Invitation link created and copied. Share it directly; no email was sent."
          );
        } catch {
          toast.success(
            "Invitation link created. Copy it below and share it directly; no email was sent."
          );
        }
      } else if (kind === "dose" && dialog?.kind === "dose") {
        await confirmDose.mutateAsync({
          familyId,
          medicationId: dialog.medicationId,
          doseDate:
            medicationRows.find(med => med.id === dialog.medicationId)
              ?.doseDate ?? todayKey(),
          doseTime: dialog.doseTime,
          note: values.note || null,
        });
        toast.success(
          values.note
            ? "Confirmation recorded with a follow-up note."
            : "Confirmation recorded."
        );
      }
      await refresh();
      if (kind !== "invite") setDialog(null);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const changeTaskStatus = async (
    task: (typeof taskRows)[number],
    status: "new" | "in_progress" | "completed"
  ) => {
    try {
      await updateTask.mutateAsync({
        familyId,
        taskId: task.id,
        title: task.title,
        description: task.description,
        dueAt: task.dueAt ? new Date(task.dueAt) : null,
        priority: task.priority,
        assigneeId: task.assigneeId,
        recurrence: task.recurrence,
        notes: task.notes,
        estimatedMinutes: task.estimatedMinutes,
        status,
      });
      await refresh();
      toast.success(
        status === "completed"
          ? "Task marked complete."
          : "Task status updated."
      );
    } catch (error) {
      showError(error);
    }
  };

  if (me.isLoading)
    return (
      <div className="auth-loading">
        <Brand />
        <Spinner />
      </div>
    );
  if (!me.data)
    return (
      <Landing
        signIn={signIn}
        error={
          me.error
            ? "We could not check your account right now. Please retry."
            : ""
        }
      />
    );

  if (isInvitationPath) {
    const join = async (accept: boolean) => {
      try {
        const result = await (accept
          ? acceptInvitation.mutateAsync({ token: invitationToken })
          : declineInvitation.mutateAsync({ token: invitationToken }));
        if (accept) {
          setSelectedId(result.familyId);
          toast.success(`You joined ${result.familyName}.`);
          await utils.care.families.list.invalidate();
        } else toast.success("Invitation declined.");
        setPath("/");
      } catch (error) {
        showError(error);
      }
    };
    return (
      <div className="invite-screen">
        <Brand />
        <section className="invite-card">
          <span className="soft-icon">
            <Users size={22} />
          </span>
          <span className="eyebrow">FAMILY INVITATION</span>
          {invitation.isLoading ? (
            <Spinner />
          ) : invitation.data ? (
            <>
              <h1>Join {invitation.data.familyName}</h1>
              <p>
                You’ve been invited to join this family’s care circle as a{" "}
                <strong>{invitation.data.role}</strong>
                {invitation.data.email ? ` · for ${invitation.data.email}` : ""}
                . Access is limited to members of this family.
              </p>
              <div className="invite-actions">
                <button
                  className="button button-primary"
                  onClick={() => join(true)}
                  disabled={acceptInvitation.isPending}
                >
                  Accept invitation
                </button>
                <button
                  className="button button-subtle"
                  onClick={() => join(false)}
                  disabled={declineInvitation.isPending}
                >
                  Decline
                </button>
              </div>
            </>
          ) : (
            <>
              <h1>This invitation is unavailable</h1>
              <p>
                It may have expired, been revoked, or already been used. Ask a
                family coordinator for a new link.
              </p>
              <button
                className="button button-subtle"
                onClick={() => setPath("/")}
              >
                Go to my family space
              </button>
            </>
          )}
        </section>
        <p className="invite-footnote">
          Care Circle helps families coordinate care. It is not a medical or
          emergency service.
        </p>
      </div>
    );
  }

  if (families.isLoading)
    return (
      <div className="auth-loading">
        <Brand />
        <Spinner />
      </div>
    );
  if (!families.data?.length)
    return (
      <div className="onboarding-screen">
        <Brand />
        <section className="onboarding-card">
          <span className="soft-icon">
            <Heart size={22} />
          </span>
          <span className="eyebrow">A PLACE FOR THE WHOLE FAMILY</span>
          <h1>Care feels lighter when it’s shared.</h1>
          <p>
            Create a private family space to keep everyday tasks, appointments,
            medication confirmations and care notes together.
          </p>
          <form onSubmit={onFamilyCreate}>
            <label className="field">
              <span>What should your family space be called?</span>
              <input
                name="name"
                required
                minLength={2}
                maxLength={160}
                placeholder="e.g. The Johnson family"
              />
            </label>
            <button
              className="button button-primary full-button"
              disabled={createFamily.isPending}
            >
              {createFamily.isPending ? "Creating…" : "Create family space"}
            </button>
          </form>
          <div className="safe-note">
            <ShieldCheck size={17} />
            <span>
              Only members you invite can see this family’s information.
            </span>
          </div>
        </section>
      </div>
    );

  if (queryError)
    return (
      <div className="error-screen">
        <Brand />
        <div className="error-card">
          <XCircle size={28} />
          <h2>Family information didn’t load</h2>
          <p>
            {queryError.message ||
              "Please check your connection and try again."}
          </p>
          <button className="button button-primary" onClick={() => refresh()}>
            Try again
          </button>
        </div>
      </div>
    );

  const navItems: {
    id: Tab;
    title: string;
    icon: LucideIcon;
    badge?: number;
  }[] = [
    { id: "home", title: "Overview", icon: HomeIcon },
    {
      id: "tasks",
      title: "Tasks",
      icon: ClipboardList,
      badge: overdueCount + unassignedCount,
    },
    { id: "calendar", title: "Calendar", icon: CalendarDays },
    {
      id: "medications",
      title: "Medications",
      icon: Pill,
      badge: unconfirmedCount,
    },
    { id: "journal", title: "Care journal", icon: Activity },
    { id: "needs", title: "Household needs", icon: ShoppingBasket },
    { id: "contacts", title: "Important contacts", icon: ContactRound },
    { id: "family", title: "Family circle", icon: Users },
  ];
  const canCoordinate = canCoordinateRole(currentFamily?.role);
  const canWrite = canWriteRole(currentFamily?.role);
  const openTask = (task?: (typeof taskRows)[number]) =>
    setDialog(task ? { kind: "task", item: task } : { kind: "task" });
  const openMedication = (medication?: (typeof medicationRows)[number]) =>
    setDialog(
      medication
        ? { kind: "medication", item: medication }
        : { kind: "medication" }
    );
  const outstandingTasks = taskRows.filter(task => task.status !== "completed");
  const sortedTasks = [...outstandingTasks].sort(
    (a, b) =>
      Number(isOverdue(b)) - Number(isOverdue(a)) ||
      new Date(a.dueAt ?? "9999-12-31").getTime() -
        new Date(b.dueAt ?? "9999-12-31").getTime()
  );
  const upcomingEvents = eventRows.filter(
    event => new Date(event.startsAt) >= now
  );
  const weekLimit = new Date(now);
  weekLimit.setDate(weekLimit.getDate() + 7);
  const visibleEvents = upcomingEvents.filter(event =>
    calendarRange === "day"
      ? eventLocalDate(event.startsAt, event.timeZone) ===
        dateKeyInZone(now, eventTimeZone(event.timeZone))
      : new Date(event.startsAt) < weekLimit
  );
  const displayName = me.data.name?.trim().split(/\s+/)[0] || "there";

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <Brand />
        </div>
        <div className="side-family">
          <span className="eyebrow">YOUR CARE CIRCLE</span>
          <div className="family-select-wrap">
            <Heart size={16} />
            <select
              aria-label="Choose family"
              value={currentFamily?.id ?? ""}
              onChange={event => setSelectedId(Number(event.target.value))}
            >
              {families.data.map(family => (
                <option value={family.id} key={family.id}>
                  {family.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
          <span className="role-label">{currentFamily?.role} access</span>
        </div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-link ${activeTab === item.id ? "active" : ""}`}
              onClick={() => {
                setActiveTab(item.id);
                setMobileMenu(false);
              }}
            >
              <item.icon size={18} strokeWidth={1.8} />
              <span>{item.title}</span>
              {!!item.badge && item.badge > 0 && (
                <span className="nav-badge">{item.badge}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`nav-link privacy-link ${activeTab === "privacy" ? "active" : ""}`}
            onClick={() => setActiveTab("privacy")}
          >
            <ShieldCheck size={17} />
            <span>Privacy & safety</span>
          </button>
          <div className="profile-block">
            <Avatar name={me.data.name} />
            <span className="profile-copy">
              <strong>{me.data.name || "Family member"}</strong>
              <small>{me.data.email || "Signed in with Manus"}</small>
            </span>
            <button
              className="icon-button logout-button"
              aria-label="Sign out"
              title="Sign out"
              onClick={() =>
                logout.mutate(undefined, {
                  onSuccess: () => {
                    utils.auth.me.invalidate();
                    toast.success("You’re signed out.");
                  },
                  onError: showError,
                })
              }
            >
              <LogOut size={17} />
            </button>
          </div>
          <p className="sidebar-disclaimer">
            For family coordination only. Not a medical or emergency service.
          </p>
        </div>
      </aside>
      {mobileMenu && (
        <button
          className="mobile-scrim"
          aria-label="Close menu"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <main className="main-area">
        <header className="topbar">
          <button
            className="mobile-menu-button icon-button"
            aria-label="Open menu"
            onClick={() => setMobileMenu(true)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            <span>{currentFamily?.name}</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{tabTitles[activeTab]}</strong>
          </div>
          <div className="topbar-right">
            <span className="today-label">
              {new Date().toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
            <Avatar name={me.data.name} />
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {activeTab === "home"
                  ? `GOOD ${now.getHours() < 12 ? "MORNING" : now.getHours() < 18 ? "AFTERNOON" : "EVENING"}, ${displayName.toUpperCase()}`
                  : currentFamily?.name.toUpperCase()}
              </span>
              <h1>
                {activeTab === "home"
                  ? "Care, shared clearly."
                  : tabTitles[activeTab]}
              </h1>
              <p>
                {activeTab === "home"
                  ? "A steady place to see what’s next and who’s taking care of it."
                  : pageSubtitle(activeTab)}
              </p>
            </div>
            {canWrite && activeTab !== "privacy" && activeTab !== "family" && (
              <button
                className="button button-primary add-button"
                onClick={() => {
                  if (activeTab === "needs") setNeedFormOpen(true);
                  else if (activeTab === "contacts") setContactFormOpen(true);
                  else if (activeTab === "tasks" || activeTab === "home")
                    setDialog({ kind: "task" });
                  else if (activeTab === "medications")
                    setDialog({ kind: "medication" });
                  else if (activeTab === "calendar")
                    setDialog({ kind: "event" });
                  else setDialog({ kind: "note" });
                }}
              >
                <Plus size={17} />
                {activeTab === "calendar"
                  ? "Add event"
                  : activeTab === "needs"
                    ? "Add need"
                    : activeTab === "contacts"
                      ? "Add contact"
                      : activeTab === "medications"
                        ? "Add medication"
                        : activeTab === "journal"
                          ? "Add update"
                          : "Add task"}
              </button>
            )}
          </div>

          {activeTab === "home" && (
            <>
              <section className="stats-row" aria-label="Family care summary">
                <StatCard
                  icon={ClipboardList}
                  label="Due today"
                  value={dueTodayCount}
                  tone="sage"
                  detail="Open tasks scheduled for today"
                  onClick={() => setActiveTab("tasks")}
                />
                <StatCard
                  icon={Clock3}
                  label="Past due"
                  value={overdueCount}
                  tone={overdueCount ? "sand" : "sage"}
                  detail={
                    overdueCount
                      ? "Needs a family check-in"
                      : "You’re all caught up"
                  }
                  onClick={() => setActiveTab("tasks")}
                />
                <StatCard
                  icon={Users}
                  label="Unassigned"
                  value={unassignedCount}
                  tone={unassignedCount ? "lavender" : "sage"}
                  detail="Tasks without a caregiver"
                  onClick={() => setActiveTab("tasks")}
                />
                <StatCard
                  icon={Pill}
                  label="Not confirmed today"
                  value={unconfirmedCount}
                  tone={unconfirmedCount ? "peach" : "sage"}
                  detail="No confirmation recorded yet"
                  onClick={() => setActiveTab("medications")}
                />
              </section>
              <div className="dashboard-columns">
                <section className="panel task-panel">
                  <PanelTitle
                    title="What needs doing"
                    caption={`${outstandingTasks.length} open ${outstandingTasks.length === 1 ? "task" : "tasks"}`}
                    action="All tasks"
                    onAction={() => setActiveTab("tasks")}
                  />
                  {sortedTasks.length ? (
                    <div className="task-list">
                      {sortedTasks.slice(0, 5).map(task => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          canEdit={
                            canWrite &&
                            (canCoordinate ||
                              task.createdBy === me.data?.id ||
                              task.assigneeId === me.data?.id)
                          }
                          isOverdue={isOverdue(task)}
                          onEdit={() => openTask(task)}
                          onComplete={() => changeTaskStatus(task, "completed")}
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      icon={CheckCircle2}
                      title="Nothing urgent on the list"
                      body="Add a task when your family needs to coordinate the next step."
                      action={
                        canWrite && (
                          <button
                            className="text-action"
                            onClick={() => openTask()}
                          >
                            Add a task <ArrowUpRight size={14} />
                          </button>
                        )
                      }
                    />
                  )}
                </section>
                <section className="panel up-next-panel">
                  <PanelTitle
                    title="Coming up"
                    caption="Appointments & visits"
                    action="Calendar"
                    onAction={() => setActiveTab("calendar")}
                  />
                  {nextEvent ? (
                    <div className="next-event">
                      <div className="event-date-tile">
                        <span>
                          {new Date(
                            `${eventLocalDate(nextEvent.startsAt, nextEvent.timeZone)}T12:00:00Z`
                          ).toLocaleDateString("en-US", {
                            month: "short",
                            timeZone: "UTC",
                          })}
                        </span>
                        <strong>
                          {eventLocalDate(
                            nextEvent.startsAt,
                            nextEvent.timeZone
                          ).slice(8, 10)}
                        </strong>
                      </div>
                      <div>
                        <span className="event-kind">
                          {nextEvent.kind === "appointment"
                            ? "MEDICAL APPOINTMENT"
                            : "FAMILY VISIT"}
                        </span>
                        <h3>{nextEvent.title}</h3>
                        <p>
                          {eventDateTime(
                            nextEvent.startsAt,
                            nextEvent.timeZone
                          )}
                        </p>
                        {nextEvent.location && (
                          <small>{nextEvent.location}</small>
                        )}
                      </div>
                    </div>
                  ) : (
                    <EmptyState
                      icon={CalendarDays}
                      title="No upcoming visits yet"
                      body="Keep the family in sync by adding an appointment or visit."
                      action={
                        canWrite && (
                          <button
                            className="text-action"
                            onClick={() => setDialog({ kind: "event" })}
                          >
                            Add to calendar <ArrowUpRight size={14} />
                          </button>
                        )
                      }
                    />
                  )}
                  <div className="upnext-divider" />
                  <div className="mini-med-title">
                    <span className="mini-icon">
                      <Pill size={16} />
                    </span>
                    <div>
                      <strong>Medication check-in</strong>
                      <small>
                        {unconfirmedCount
                          ? `${unconfirmedCount} confirmation${unconfirmedCount === 1 ? "" : "s"} not recorded today`
                          : "Every active medication has a confirmation today"}
                      </small>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Open medication list"
                      onClick={() => setActiveTab("medications")}
                    >
                      <ArrowUpRight size={16} />
                    </button>
                  </div>
                </section>
              </div>
              <section className="panel journal-preview">
                <PanelTitle
                  title="Latest family updates"
                  caption="Care journal"
                  action="Open journal"
                  onAction={() => setActiveTab("journal")}
                />
                {noteRows.length ? (
                  <div className="journal-preview-list">
                    {noteRows.slice(0, 3).map(note => (
                      <JournalEntry key={note.id} note={note} compact />
                    ))}
                  </div>
                ) : (
                  <div className="journal-empty">
                    <span>
                      Leave a short note for the next person stepping in.
                    </span>
                    {canWrite && (
                      <button
                        className="text-action"
                        onClick={() => setDialog({ kind: "note" })}
                      >
                        Add an update <Plus size={14} />
                      </button>
                    )}
                  </div>
                )}
              </section>
              <p className="dashboard-footnote">
                <ShieldCheck size={15} /> Medication confirmations are
                family-entered records, not verification. Care Circle does not
                provide medical advice or emergency response.
              </p>
            </>
          )}

          {activeTab === "tasks" && (
            <section className="panel full-panel">
              <PanelTitle
                title="Shared task list"
                caption="One owner, one next step"
                action={canWrite ? "Add a task" : undefined}
                onAction={() => openTask()}
              />
              {taskRows.length ? (
                <div className="task-list">
                  {[...taskRows]
                    .sort(
                      (a, b) =>
                        Number(isOverdue(b)) - Number(isOverdue(a)) ||
                        Number(a.status === "completed") -
                          Number(b.status === "completed") ||
                        new Date(a.dueAt ?? "9999-12-31").getTime() -
                          new Date(b.dueAt ?? "9999-12-31").getTime()
                    )
                    .map(task => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        canEdit={
                          canWrite &&
                          (canCoordinate ||
                            task.createdBy === me.data?.id ||
                            task.assigneeId === me.data?.id)
                        }
                        isOverdue={isOverdue(task)}
                        onEdit={() => openTask(task)}
                        onComplete={() =>
                          changeTaskStatus(
                            task,
                            task.status === "completed"
                              ? "in_progress"
                              : "completed"
                          )
                        }
                        onDelete={async () => {
                          if (
                            !window.confirm(
                              `Delete “${task.title}”? This cannot be undone.`
                            )
                          )
                            return;
                          try {
                            await deleteTask.mutateAsync({
                              familyId,
                              taskId: task.id,
                            });
                            await refresh();
                            toast.success("Task deleted.");
                          } catch (error) {
                            showError(error);
                          }
                        }}
                        showDelete={canCoordinate}
                      />
                    ))}
                </div>
              ) : (
                <EmptyState
                  icon={ClipboardList}
                  title="Your shared list starts here"
                  body="Add a practical task so everyone knows what needs doing, when, and who has it."
                  action={
                    canWrite && (
                      <button
                        className="button button-primary"
                        onClick={() => openTask()}
                      >
                        <Plus size={16} />
                        Add a task
                      </button>
                    )
                  }
                />
              )}
              <div className="list-legend">
                <span className="status-dot dot-overdue" />
                Past due is based on its due time, unless the task is complete.
                <span className="legend-divider" />
                <Users size={14} />
                {unassignedCount} without an owner
              </div>
              <CollaborationPanels familyId={familyId} userId={me.data.id} canWrite={canWrite} />
              <Phase3Insights familyId={familyId} />
            </section>
          )}

          {activeTab === "calendar" && (
            <section className="panel full-panel">
              <PanelTitle
                title="Appointments & visits"
                caption="Shared by your family"
                action={canWrite ? "Add an event" : undefined}
                onAction={() => setDialog({ kind: "event" })}
              />
              <div
                className="calendar-view-switch"
                role="tablist"
                aria-label="Calendar range"
              >
                <button
                  role="tab"
                  aria-selected={calendarRange === "day"}
                  className={calendarRange === "day" ? "selected" : ""}
                  onClick={() => setCalendarRange("day")}
                >
                  Today
                </button>
                <button
                  role="tab"
                  aria-selected={calendarRange === "week"}
                  className={calendarRange === "week" ? "selected" : ""}
                  onClick={() => setCalendarRange("week")}
                >
                  Next 7 days
                </button>
              </div>
              {visibleEvents.length ? (
                <div className="event-list">
                  {visibleEvents.map(event => (
                    <article className="event-row" key={event.id}>
                      <div className="event-date-tile">
                        <span>
                          {new Date(
                            `${eventLocalDate(event.startsAt, event.timeZone)}T12:00:00Z`
                          ).toLocaleDateString("en-US", {
                            month: "short",
                            timeZone: "UTC",
                          })}
                        </span>
                        <strong>
                          {eventLocalDate(event.startsAt, event.timeZone).slice(
                            8,
                            10
                          )}
                        </strong>
                      </div>
                      <div className="event-row-body">
                        <span className="event-kind">
                          {event.kind === "appointment"
                            ? "MEDICAL APPOINTMENT"
                            : "FAMILY VISIT"}
                        </span>
                        <h3>{event.title}</h3>
                        <p>{eventDateTime(event.startsAt, event.timeZone)}</p>
                        {event.location && <small>{event.location}</small>}
                        {event.escortName && (
                          <small className="escort-label">
                            Accompanying: {event.escortName}
                          </small>
                        )}
                        {event.questions && (
                          <details>
                            <summary>Questions for the clinician</summary>
                            <p>{event.questions}</p>
                          </details>
                        )}
                        {event.visitNotes && (
                          <details>
                            <summary>Visit notes</summary>
                            <p>{event.visitNotes}</p>
                          </details>
                        )}
                      </div>
                      <span className="reminder-pill">
                        <Clock3 size={13} />
                        {reminderPreference(event.reminderMinutes)}
                      </span>
                      {canWrite &&
                        (canCoordinate || event.createdBy === me.data?.id) && (
                          <div className="event-actions">
                            <button
                              className="button button-subtle small-button"
                              onClick={() =>
                                setDialog({ kind: "event", item: event })
                              }
                            >
                              Edit
                            </button>
                            <button
                              className="text-danger"
                              onClick={async () => {
                                if (
                                  !window.confirm(
                                    `Delete “${event.title}”? This cannot be undone.`
                                  )
                                )
                                  return;
                                try {
                                  await deleteEvent.mutateAsync({
                                    familyId,
                                    eventId: event.id,
                                  });
                                  await refresh();
                                  toast.success("Event deleted.");
                                } catch (error) {
                                  showError(error);
                                }
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={CalendarDays}
                  title="No events on the calendar"
                  body="Add medical appointments and family visits with the time, place and person accompanying."
                  action={
                    canWrite && (
                      <button
                        className="button button-primary"
                        onClick={() => setDialog({ kind: "event" })}
                      >
                        <Plus size={16} />
                        Add an event
                      </button>
                    )
                  }
                />
              )}
              <p className="form-hint calendar-hint">
                Each event is shown in its saved time zone. Reminder preferences
                are saved, but this first stage does not send notifications.
              </p>
              <HandoffPanel familyId={familyId} canWrite={canWrite} />
            </section>
          )}

          {activeTab === "medications" && (
            <>
              <div className="notice-banner">
                <span className="notice-icon">
                  <Pill size={17} />
                </span>
                <p>
                  <strong>Family tracking only.</strong> Follow the clinician’s
                  instructions. A reminder or open screen is not confirmation,
                  and this app does not verify whether a dose was given. Each
                  scheduled time has its own confirmation for the medication’s
                  local date. Automated reminders are not sent in this stage.
                </p>
              </div>
              <section className="panel full-panel">
                <PanelTitle title="In-app notification settings" caption="Your consent applies to this family only" />
                <p className="form-hint">Email delivery is not configured. Nothing is sent by email, push, or outside this app. In-app reminders are best-effort and are not guaranteed; this is not an emergency service.</p>
                <label className="check-field"><input type="checkbox" checked={notificationPreferences.data?.reminderOptIn ?? false} onChange={async e => { try { await setNotificationPreferences.mutateAsync({ familyId, reminderOptIn: e.target.checked, escalationOptIn: notificationPreferences.data?.escalationOptIn ?? false }); await notificationPreferences.refetch(); } catch (error) { showError(error); } }} /><span>Allow in-app dose reminders and 10-minute “not confirmed yet” alerts for me</span></label>
                <label className="check-field"><input type="checkbox" checked={notificationPreferences.data?.escalationOptIn ?? false} onChange={async e => { try { await setNotificationPreferences.mutateAsync({ familyId, reminderOptIn: notificationPreferences.data?.reminderOptIn ?? false, escalationOptIn: e.target.checked }); await notificationPreferences.refetch(); } catch (error) { showError(error); } }} /><span>I explicitly agree to receive in-app 20-minute dose escalations for this family</span></label>
                <h3>In-app inbox</h3>
                {(notificationInbox.data ?? []).length === 0 ? <p className="form-hint">No in-app notifications.</p> : (notificationInbox.data ?? []).map(item => <article className="dose-row" key={item.id}><div className="dose-row-copy"><strong>{item.message}</strong><span>{item.doseDate} · {item.doseTime} · {item.status} · email delivery: {item.emailDeliveryStatus}</span></div>{item.status === "created" && <button className="button button-subtle small-button" onClick={async () => { await markNotificationRead.mutateAsync({ familyId, notificationId: item.id }); await notificationInbox.refetch(); }}>Mark read</button>}</article>)}
              </section>
              <section className="panel full-panel">
                <PanelTitle
                  title="Medication list"
                  caption="A shared record, entered by your family"
                  action={canWrite ? "Add medication" : undefined}
                  onAction={() => openMedication()}
                />
                {medicationRows.length ? (
                  <div className="medication-list">
                    {medicationRows.map(med => (
                      <article className="med-row" key={med.id}>
                        <div className="med-icon">
                          <Pill size={18} />
                        </div>
                        <div className="med-main">
                          <div className="med-title-line">
                            <h3>{med.name}</h3>
                            <span
                              className={`confirmation-pill ${med.doses.some(dose => !dose.confirmation) ? "pending" : "confirmed"}`}
                            >
                              {med.doses.filter(dose => !dose.confirmation)
                                .length
                                ? `${med.doses.filter(dose => !dose.confirmation).length} dose${med.doses.filter(dose => !dose.confirmation).length === 1 ? "" : "s"} not confirmed`
                                : "All scheduled doses confirmed"}
                            </span>
                          </div>
                          <p className="med-dose">
                            {med.dose} <span>·</span> {med.schedule}
                          </p>
                          <small>
                            Times follow {med.timeZone} · local date{" "}
                            {med.doseDate}
                          </small>
                          {med.assigneeName && (
                            <small>Point person: {med.assigneeName}</small>
                          )}
                          {med.startDate && (
                            <small>
                              Started {shortDate(`${med.startDate}T12:00:00`)}
                              {med.endDate
                                ? ` · Ends ${shortDate(`${med.endDate}T12:00:00`)}`
                                : ""}
                            </small>
                          )}
                          {med.notes && <p className="med-note">{med.notes}</p>}
                          <div className="dose-list">
                            {med.doses.map(dose => {
                              const confirmation = dose.confirmation;
                              const canConfirmNow = canConfirmDoseAt(
                                med.doseDate,
                                dose.time,
                                med.timeZone,
                                now
                              );
                              return (
                                <div
                                  className="dose-row"
                                  key={`${med.id}-${dose.time}`}
                                >
                                  <div className="dose-row-copy">
                                    <strong>
                                      {dose.time === "once"
                                        ? "Daily dose"
                                        : dose.time}
                                    </strong>
                                    {confirmation ? (
                                      <span className="dose-confirmation-meta">
                                        {confirmation.status === "confirmed"
                                          ? "Confirmed"
                                          : "Follow-up needed"}{" "}
                                        by{" "}
                                        {confirmation.confirmerName ||
                                          "a family member"}{" "}
                                        · {dateTime(confirmation.confirmedAt)}
                                        {confirmation.note
                                          ? ` · ${confirmation.note}`
                                          : ""}
                                      </span>
                                    ) : (
                                      <span>
                                        {canConfirmNow
                                          ? "Not confirmed for this local date"
                                          : `Scheduled for ${dose.time} · confirmation opens at that local time`}
                                      </span>
                                    )}
                                  </div>
                                  {canWrite && !confirmation && (
                                    <button
                                      className="button button-subtle small-button"
                                      disabled={!canConfirmNow}
                                      onClick={() =>
                                        setDialog({
                                          kind: "dose",
                                          medicationId: med.id,
                                          medicationName: med.name,
                                          doseTime: dose.time,
                                        })
                                      }
                                    >
                                      {canConfirmNow
                                        ? "Record confirmation"
                                        : `Available at ${dose.time}`}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div className="med-actions">
                          {canWrite &&
                            (canCoordinate ||
                              med.createdBy === me.data?.id ||
                              med.assigneeId === me.data?.id) && (
                              <button
                                className="icon-button"
                                aria-label={`Edit ${med.name}`}
                                onClick={() => openMedication(med)}
                              >
                                <span className="edit-word">Edit</span>
                                <ChevronDown
                                  className="edit-chevron"
                                  size={15}
                                />
                              </button>
                            )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={Pill}
                    title="No medication listed"
                    body="Add a medication name, the prescribed dose and your family’s reminder schedule."
                    action={
                      canWrite && (
                        <button
                          className="button button-primary"
                          onClick={() => openMedication()}
                        >
                          <Plus size={16} />
                          Add medication
                        </button>
                      )
                    }
                  />
                )}
                <p className="form-hint calendar-hint">
                  A confirmation records who entered it and when. It is not
                  medical verification and does not change any dose or schedule.
                </p>
              </section>
            </>
          )}

          {activeTab === "needs" && (
            <section className="panel full-panel">
              <PanelTitle
                title="Shared household needs"
                caption="Items your family has asked to track"
              />
              {needs.isLoading ? (
                <div className="loading-state">
                  <span className="spinner" />
                  Loading household needs…
                </div>
              ) : needs.error ? (
                <div className="data-error" role="alert">
                  Household needs could not be loaded.{" "}
                  <button
                    className="text-action"
                    onClick={() =>
                      void utils.care.householdNeeds.list.invalidate({
                        familyId,
                      })
                    }
                  >
                    Try again
                  </button>
                </div>
              ) : needRows.length ? (
                <div className="shared-record-list">
                  {needRows.map(item => (
                    <article
                      className={`shared-record ${item.completed ? "record-complete" : ""}`}
                      key={item.id}
                    >
                      <div className="record-copy">
                        <span
                          className={`priority-pill priority-${item.priority}`}
                        >
                          {item.priority} priority
                        </span>
                        <h3>{item.name}</h3>
                        <p>
                          {item.quantity || "Quantity not specified"}
                          {item.buyerName
                            ? ` · Buyer: ${item.buyerName}`
                            : " · No buyer assigned"}
                        </p>
                      </div>
                      <div className="record-actions">
                        {canWrite &&
                          (canCoordinate || item.createdBy === me.data?.id) && (
                            <button
                              className="button button-subtle small-button"
                              onClick={async () => {
                                try {
                                  await updateNeed.mutateAsync({
                                    familyId,
                                    needId: item.id,
                                    name: item.name,
                                    quantity: item.quantity,
                                    priority: item.priority,
                                    buyerId: item.buyerId,
                                    completed: !item.completed,
                                  });
                                  await refresh();
                                  toast.success(
                                    item.completed
                                      ? "Need marked open."
                                      : "Need marked complete."
                                  );
                                } catch (error) {
                                  showError(error);
                                }
                              }}
                            >
                              {item.completed ? "Reopen" : "Complete"}
                            </button>
                          )}
                        {canWrite &&
                          (canCoordinate || item.createdBy === me.data?.id) && (
                            <button
                              className="text-action"
                              onClick={() => {
                                setEditingNeedId(item.id);
                                setNeedFormOpen(true);
                              }}
                            >
                              Edit
                            </button>
                          )}
                        {canWrite &&
                          (canCoordinate || item.createdBy === me.data?.id) && (
                            <button
                              className="text-danger"
                              onClick={async () => {
                                if (!window.confirm(`Delete “${item.name}”?`))
                                  return;
                                try {
                                  await deleteNeed.mutateAsync({
                                    familyId,
                                    needId: item.id,
                                  });
                                  await refresh();
                                  toast.success("Need deleted.");
                                } catch (error) {
                                  showError(error);
                                }
                              }}
                            >
                              Delete
                            </button>
                          )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={ShoppingBasket}
                  title="No shared needs yet"
                  body="Add a household item the family wants to remember. Use this list for family-entered items only; it does not make care or medication recommendations."
                  action={
                    canWrite ? (
                      <button
                        className="button button-primary"
                        onClick={() => setNeedFormOpen(true)}
                      >
                        <Plus size={16} />
                        Add a need
                      </button>
                    ) : undefined
                  }
                />
              )}
              {needFormOpen && canWrite && (
                <form
                  key={editingNeedId ?? "new-need"}
                  className="shared-form"
                  onSubmit={async event => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    const existing = needRows.find(
                      row => row.id === editingNeedId
                    );
                    const input = {
                      familyId,
                      name: String(data.get("name") || "").trim(),
                      quantity:
                        String(data.get("quantity") || "").trim() || null,
                      priority: String(data.get("priority") || "medium") as
                        | "low"
                        | "medium"
                        | "high",
                      buyerId: Number(data.get("buyerId")) || null,
                      completed: existing?.completed ?? false,
                    };
                    try {
                      if (editingNeedId)
                        await updateNeed.mutateAsync({
                          ...input,
                          needId: editingNeedId,
                        });
                      else await createNeed.mutateAsync(input);
                      await refresh();
                      setNeedFormOpen(false);
                      setEditingNeedId(null);
                      toast.success(
                        editingNeedId ? "Need updated." : "Need added."
                      );
                    } catch (error) {
                      showError(error);
                    }
                  }}
                >
                  <h3>
                    {editingNeedId
                      ? "Edit household need"
                      : "Add a household need"}
                  </h3>
                  <label>
                    Item name
                    <input
                      name="name"
                      required
                      maxLength={180}
                      defaultValue={
                        needRows.find(row => row.id === editingNeedId)?.name
                      }
                    />
                  </label>
                  <label>
                    Quantity or size
                    <input
                      name="quantity"
                      maxLength={120}
                      placeholder="Optional"
                      defaultValue={
                        needRows.find(row => row.id === editingNeedId)
                          ?.quantity ?? ""
                      }
                    />
                  </label>
                  <label>
                    Priority
                    <select
                      name="priority"
                      defaultValue={
                        needRows.find(row => row.id === editingNeedId)
                          ?.priority ?? "medium"
                      }
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </label>
                  <label>
                    Buyer
                    <select
                      name="buyerId"
                      defaultValue={
                        needRows.find(row => row.id === editingNeedId)
                          ?.buyerId ?? ""
                      }
                    >
                      <option value="">Unassigned</option>
                      {memberOptions.map(member => (
                        <option key={member.userId} value={member.userId}>
                          {member.name || "Family member"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="button button-subtle"
                      onClick={() => {
                        setNeedFormOpen(false);
                        setEditingNeedId(null);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="button button-primary"
                      disabled={createNeed.isPending || updateNeed.isPending}
                    >
                      Save need
                    </button>
                  </div>
                </form>
              )}
              <p className="form-hint calendar-hint">
                Only family-provided item details are stored here; no medical
                advice or purchase recommendations are generated.
              </p>
            </section>
          )}
          {activeTab === "contacts" && (
            <section className="panel full-panel">
              <PanelTitle
                title="Important family contacts"
                caption="Contact details shared with current family members"
              />
              <div className="notice-banner emergency-disclaimer">
                <span className="notice-icon">
                  <ShieldCheck size={17} />
                </span>
                <p>
                  <strong>Emergency contact details are not monitored.</strong>{" "}
                  Care Circle is not an emergency service, does not monitor
                  these contacts, and cannot guarantee that anyone will respond.
                  For an emergency, contact local emergency services directly.
                </p>
              </div>
              {contacts.isLoading ? (
                <div className="loading-state">
                  <span className="spinner" />
                  Loading family contacts…
                </div>
              ) : contacts.error ? (
                <div className="data-error" role="alert">
                  Contacts could not be loaded.{" "}
                  <button
                    className="text-action"
                    onClick={() =>
                      void utils.care.importantContacts.list.invalidate({
                        familyId,
                      })
                    }
                  >
                    Try again
                  </button>
                </div>
              ) : contactRows.length ? (
                <div className="shared-record-list">
                  {contactRows.map(item => (
                    <article className="shared-record" key={item.id}>
                      <div className="record-copy">
                        <span className="contact-kind">
                          {item.kind === "provider"
                            ? "PROVIDER"
                            : item.kind === "clinic"
                              ? "CLINIC"
                              : item.kind === "family"
                                ? "FAMILY"
                                : "EMERGENCY CONTACT"}
                        </span>
                        <h3>{item.name}</h3>
                        {item.organization && <p>{item.organization}</p>}
                        {item.phone && (
                          <a href={`tel:${item.phone}`}>{item.phone}</a>
                        )}
                        {item.email && (
                          <a href={`mailto:${item.email}`}>{item.email}</a>
                        )}
                        {item.notes && <small>{item.notes}</small>}
                      </div>
                      <div className="record-actions">
                        {canWrite &&
                          (canCoordinate || item.createdBy === me.data?.id) && (
                            <button
                              className="button button-subtle small-button"
                              onClick={() => {
                                setEditingContactId(item.id);
                                setContactFormOpen(true);
                              }}
                            >
                              Edit
                            </button>
                          )}
                        {canWrite && canCoordinate && (
                          <button
                            className="text-danger"
                            onClick={async () => {
                              if (
                                !window.confirm(
                                  `Delete contact “${item.name}”?`
                                )
                              )
                                return;
                              try {
                                await deleteContact.mutateAsync({
                                  familyId,
                                  contactId: item.id,
                                });
                                await refresh();
                                toast.success("Contact deleted.");
                              } catch (error) {
                                showError(error);
                              }
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={ContactRound}
                  title="No contacts saved"
                  body="Add a provider, clinic, family, or emergency contact your family chooses to share."
                  action={
                    canWrite ? (
                      <button
                        className="button button-primary"
                        onClick={() => setContactFormOpen(true)}
                      >
                        <Plus size={16} />
                        Add a contact
                      </button>
                    ) : undefined
                  }
                />
              )}
              {contactFormOpen && canWrite && (
                <form
                  key={editingContactId ?? "new-contact"}
                  className="shared-form"
                  onSubmit={async event => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    const input = {
                      familyId,
                      kind: String(data.get("kind") || "family") as
                        | "provider"
                        | "clinic"
                        | "family"
                        | "emergency",
                      name: String(data.get("name") || "").trim(),
                      organization:
                        String(data.get("organization") || "").trim() || null,
                      phone: String(data.get("phone") || "").trim() || null,
                      email: String(data.get("email") || "").trim() || null,
                      notes: String(data.get("notes") || "").trim() || null,
                    };
                    try {
                      if (editingContactId)
                        await updateContact.mutateAsync({
                          ...input,
                          contactId: editingContactId,
                        });
                      else await createContact.mutateAsync(input);
                      await refresh();
                      setContactFormOpen(false);
                      setEditingContactId(null);
                      toast.success(
                        editingContactId ? "Contact updated." : "Contact added."
                      );
                    } catch (error) {
                      showError(error);
                    }
                  }}
                >
                  <h3>
                    {editingContactId
                      ? "Edit family contact"
                      : "Add an important contact"}
                  </h3>
                  <label>
                    Type
                    <select
                      name="kind"
                      defaultValue={
                        contactRows.find(row => row.id === editingContactId)
                          ?.kind ?? "family"
                      }
                    >
                      <option value="provider">Provider</option>
                      <option value="clinic">Clinic</option>
                      <option value="family">Family</option>
                      <option value="emergency">Emergency contact</option>
                    </select>
                  </label>
                  <label>
                    Name
                    <input
                      name="name"
                      required
                      maxLength={180}
                      defaultValue={
                        contactRows.find(row => row.id === editingContactId)
                          ?.name
                      }
                    />
                  </label>
                  <label>
                    Organization
                    <input
                      name="organization"
                      maxLength={180}
                      defaultValue={
                        contactRows.find(row => row.id === editingContactId)
                          ?.organization ?? ""
                      }
                    />
                  </label>
                  <label>
                    Phone
                    <input
                      name="phone"
                      type="tel"
                      maxLength={80}
                      defaultValue={
                        contactRows.find(row => row.id === editingContactId)
                          ?.phone ?? ""
                      }
                    />
                  </label>
                  <label>
                    Email
                    <input
                      name="email"
                      type="email"
                      maxLength={320}
                      defaultValue={
                        contactRows.find(row => row.id === editingContactId)
                          ?.email ?? ""
                      }
                    />
                  </label>
                  <label>
                    Family-entered note
                    <textarea
                      name="notes"
                      maxLength={1000}
                      rows={3}
                      defaultValue={
                        contactRows.find(row => row.id === editingContactId)
                          ?.notes ?? ""
                      }
                    />
                  </label>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="button button-subtle"
                      onClick={() => {
                        setContactFormOpen(false);
                        setEditingContactId(null);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="button button-primary"
                      disabled={
                        createContact.isPending || updateContact.isPending
                      }
                    >
                      Save contact
                    </button>
                  </div>
                </form>
              )}
              <p className="form-hint calendar-hint">
                These are user-entered directory details, visible to current
                members of this family. They are not checked or monitored by the
                app.
              </p>
            </section>
          )}
          {activeTab === "journal" && (
            <section className="panel full-panel">
              <PanelTitle
                title="The care journal"
                caption="A clear handoff between family members"
                action={canWrite ? "Add an update" : undefined}
                onAction={() => setDialog({ kind: "note" })}
              />
              {noteRows.length ? (
                <div className="journal-timeline">
                  {noteRows.map(note => (
                    <JournalEntry key={note.id} note={note} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={Activity}
                  title="Start with a small update"
                  body="Capture a visit note, a question to ask, or what the next caregiver should know."
                  action={
                    canWrite && (
                      <button
                        className="button button-primary"
                        onClick={() => setDialog({ kind: "note" })}
                      >
                        <Plus size={16} />
                        Add an update
                      </button>
                    )
                  }
                />
              )}
              <p className="form-hint calendar-hint">
                Entries are family notes, not diagnoses or medical advice. Mark
                an entry as a confirmed fact only when you know it is confirmed.
              </p>
            </section>
          )}

          {activeTab === "family" && (
            <div className="family-columns">
              <section className="panel full-panel">
                <PanelTitle
                  title="People in your circle"
                  caption={`${memberRows.length} ${memberRows.length === 1 ? "member" : "members"}`}
                  action={canCoordinate ? "Invite someone" : undefined}
                  onAction={() => setDialog({ kind: "invite" })}
                />
                <div className="member-list">
                  {memberRows.map(member => (
                    <article className="member-row" key={member.id}>
                      <Avatar name={member.name} />
                      <div className="member-main">
                        <strong>{member.name || "Family member"}</strong>
                        <small>
                          {member.email || "Signed in family member"}
                        </small>
                      </div>
                      {canCoordinate && member.role !== "owner" ? (
                        <select
                          className="role-select"
                          value={member.role}
                          aria-label={`Role for ${member.name || "member"}`}
                          onChange={async event => {
                            try {
                              await changeRole.mutateAsync({
                                familyId,
                                memberId: member.id,
                                role: event.target.value as
                                  | "coordinator"
                                  | "caregiver"
                                  | "viewer",
                              });
                              await refresh();
                              toast.success("Family role updated.");
                            } catch (error) {
                              showError(error);
                            }
                          }}
                        >
                          <option value="coordinator">Coordinator</option>
                          <option value="caregiver">Caregiver</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      ) : (
                        <span
                          className={`role-pill ${member.role === "owner" ? "owner" : ""}`}
                        >
                          {member.role}
                        </span>
                      )}
                      {canCoordinate && member.role !== "owner" && (
                        <button
                          className="text-danger"
                          onClick={async () => {
                            if (
                              !window.confirm(
                                `Remove ${member.name || "this member"} from ${currentFamily?.name}?`
                              )
                            )
                              return;
                            try {
                              await removeMember.mutateAsync({
                                familyId,
                                memberId: member.id,
                              });
                              await refresh();
                              toast.success("Member removed from this family.");
                            } catch (error) {
                              showError(error);
                            }
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </article>
                  ))}
                </div>
                {canCoordinate && (
                  <div className="invite-link-note">
                    <ShieldCheck size={17} />
                    <span>
                      Invite links expire after 7 days and can be revoked here.
                      Links are not emailed by this app.
                    </span>
                  </div>
                )}
              </section>
              <div className="family-side">
                <section className="panel family-info">
                  <span className="soft-icon">
                    <Heart size={19} />
                  </span>
                  <span className="eyebrow">YOUR FAMILY SPACE</span>
                  <h3>{currentFamily?.name}</h3>
                  <p>
                    Your role is <strong>{currentFamily?.role}</strong>. Only
                    members of this family can view its care information.
                  </p>
                  {currentFamily?.role === "owner" ? (
                    <div className="transfer-owner-control">
                      <label className="field">
                        <span>Transfer ownership to a current member</span>
                        <select
                          value={transferTargetId ?? ""}
                          onChange={event =>
                            setTransferTargetId(
                              Number(event.target.value) || null
                            )
                          }
                        >
                          <option value="">Choose a family member</option>
                          {memberRows
                            .filter(member => member.role !== "owner")
                            .map(member => (
                              <option key={member.id} value={member.id}>
                                {member.name || "Family member"}
                              </option>
                            ))}
                        </select>
                      </label>
                      <button
                        className="button button-subtle small-button"
                        disabled={
                          !transferTargetId || transferOwnership.isPending
                        }
                        onClick={async () => {
                          if (!transferTargetId) return;
                          const target = memberRows.find(
                            member => member.id === transferTargetId
                          );
                          if (!target) return;
                          if (
                            !window.confirm(
                              `Transfer ownership to ${target.name || "this member"}? You will become a coordinator and can leave afterward.`
                            )
                          )
                            return;
                          try {
                            await transferOwnership.mutateAsync({
                              familyId,
                              memberId: transferTargetId,
                            });
                            setTransferTargetId(null);
                            await refresh();
                            toast.success(
                              "Ownership transferred. Your role is now coordinator."
                            );
                          } catch (error) {
                            showError(error);
                          }
                        }}
                      >
                        {transferOwnership.isPending
                          ? "Transferring…"
                          : "Transfer ownership"}
                      </button>
                      <small className="transfer-owner-hint">
                        Transfer first to become a coordinator, then leave if
                        needed.
                      </small>
                    </div>
                  ) : (
                    <button
                      className="text-danger leave-button"
                      onClick={async () => {
                        if (
                          !window.confirm(
                            "Leave this family? You’ll lose access to its shared care information."
                          )
                        )
                          return;
                        try {
                          await leaveFamily.mutateAsync({ familyId });
                          setSelectedId(null);
                          await utils.care.families.list.invalidate();
                          toast.success("You left the family space.");
                        } catch (error) {
                          showError(error);
                        }
                      }}
                    >
                      Leave family space
                    </button>
                  )}
                </section>
                {canCoordinate && (
                  <section className="panel invitations-panel">
                    <PanelTitle
                      title="Invitation links"
                      caption="Pending and recent"
                    />
                    {invitations.data?.length ? (
                      invitations.data.slice(0, 6).map(invite => (
                        <div className="invitation-row" key={invite.id}>
                          <div>
                            <strong>{invite.email || "Link invitation"}</strong>
                            <small>
                              {invite.role} · {invite.status} · Expires{" "}
                              {shortDate(invite.expiresAt)}
                            </small>
                          </div>
                          {invite.status === "pending" && (
                            <button
                              className="text-danger"
                              onClick={async () => {
                                try {
                                  await revokeInvitation.mutateAsync({
                                    familyId,
                                    invitationId: invite.id,
                                  });
                                  await refresh();
                                  toast.success("Invitation revoked.");
                                } catch (error) {
                                  showError(error);
                                }
                              }}
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="empty-copy">No invitations created yet.</p>
                    )}
                  </section>
                )}
              </div>
            </div>
          )}

          {activeTab === "privacy" && (
            <section className="panel privacy-panel">
              <div className="privacy-lead">
                <span className="soft-icon">
                  <ShieldCheck size={22} />
                </span>
                <span className="eyebrow">A NOTE ON TRUST</span>
                <h2>Care is personal. Keep the circle small.</h2>
                <p>
                  Care Circle is built for family coordination—not clinical
                  decision-making, emergency response or a medical record.
                </p>
              </div>
              <div className="privacy-grid">
                <article>
                  <h3>
                    <Users size={17} /> Family-only access
                  </h3>
                  <p>
                    Family data is shown only to signed-in users with an active
                    membership in that family. Family roles are checked by the
                    server for each data request.
                  </p>
                </article>
                <article>
                  <h3>
                    <ClipboardList size={17} /> Information stored
                  </h3>
                  <p>
                    The app stores account identifiers and profile details,
                    family names and membership roles, invitation records, and
                    the care information you enter: tasks, medication names and
                    prescribed-dose notes, dose schedules and confirmations,
                    appointments, and journal entries. Do not enter details you
                    are not authorized to share.
                  </p>
                </article>
                <article>
                  <h3>
                    <Heart size={17} /> Purpose and access
                  </h3>
                  <p>
                    Information is used to coordinate care within the selected
                    family space. Signed-in family members with active
                    membership can view shared records; server-side role checks
                    control write, management, and export actions. Invite links
                    grant access only after the invited person accepts.
                  </p>
                </article>
                <article>
                  <h3>
                    <ShieldCheck size={17} /> Storage and sharing
                  </h3>
                  <p>
                    Care Circle stores shared records in its application
                    database and processes sign-in through the configured Manus
                    account service. This version does not send family
                    invitations or medication reminders by email and does not
                    use a paid AI service. The platform’s own service terms and
                    safeguards also apply.
                  </p>
                </article>
                <article>
                  <h3>
                    <Download size={17} /> Export and retention
                  </h3>
                  <p>
                    An owner or coordinator can download the selected family’s
                    shared records as JSON. Shared records are retained for
                    family continuity until handled through available in-product
                    actions. No separate backup or recovery promise is made by
                    this policy.
                  </p>
                </article>
                <article>
                  <h3>
                    <ShieldCheck size={17} /> Use care with sensitive details
                  </h3>
                  <p>
                    Share only what the family needs to coordinate. Do not enter
                    payment details, passwords, highly sensitive medical records
                    or information you do not have permission to share.
                  </p>
                </article>
                <article>
                  <h3>
                    <Pill size={17} /> Not medical advice
                  </h3>
                  <p>
                    Medication doses and schedules should come from the
                    clinician. A family confirmation is only a record of what a
                    member entered; the app cannot verify that a dose was given.
                  </p>
                </article>
                <article>
                  <h3>
                    <CircleHelp size={17} /> No emergency service
                  </h3>
                  <p>
                    This app does not monitor emergencies or guarantee that a
                    family member will respond. For emergencies, contact local
                    emergency services.
                  </p>
                </article>
              </div>
              <div className="privacy-actions">
                {canCoordinate && (
                  <button
                    className="button button-subtle"
                    onClick={downloadFamilyExport}
                    disabled={exportFamily.isPending}
                  >
                    <Download size={16} />
                    {exportFamily.isPending
                      ? "Preparing export…"
                      : "Download this family’s data"}
                  </button>
                )}
                <p>
                  {canCoordinate
                    ? "Exports the selected family’s shared records to this device as JSON. No other family spaces are included."
                    : "Combined family exports are limited to the family owner or coordinator. Ask one of them to prepare an export."}
                </p>
              </div>
              <section className="account-deletion">
                <h3>Delete your Care Circle account</h3>
                <p>
                  Deletion removes your Care Circle profile and sign-in
                  identifier, removes your family memberships, clears your
                  personal task assignments, and cancels your pending
                  invitations. Shared family history is retained; direct
                  authorship is replaced with “Former family member,” and the
                  text you entered may remain visible to the family. Ownership
                  must be transferred for every family you own before deletion
                  can proceed. This does not delete your Manus account.
                </p>
                <button
                  className="button button-danger"
                  disabled={deleteAccount.isPending}
                  onClick={async () => {
                    const confirmed = window.confirm(
                      "Permanently delete your Care Circle account? Your profile and access will be removed, but shared family history and text you entered may remain under ‘Former family member.’ This cannot be undone."
                    );
                    if (!confirmed) return;
                    try {
                      await deleteAccount.mutateAsync();
                      try {
                        sessionStorage.removeItem("manus-cookie");
                        localStorage.removeItem("manus-runtime-user-info");
                        localStorage.removeItem("care-circle-family");
                      } catch {}
                      toast.success("Your Care Circle account was deleted.");
                      window.location.assign("/");
                    } catch (error) {
                      showError(error);
                    }
                  }}
                >
                  {deleteAccount.isPending
                    ? "Deleting account…"
                    : "Delete my account"}
                </button>
                <small>
                  If you own a family, transfer ownership first. If you sign in
                  again later with the same Manus identity, a new Care Circle
                  account may be created.
                </small>
              </section>
              <p className="privacy-implementation-note">
                This in-product privacy disclosure describes this version’s
                behavior. It is not legal advice or a legal review, and Care
                Circle does not claim HIPAA compliance. Care Circle is not a
                medical, clinical, or emergency service. For emergencies,
                contact local emergency services.
              </p>
            </section>
          )}

          {inviteLink && (
            <div className="created-invite">
              <div>
                <strong>Invitation link ready</strong>
                <small>Share it privately. No email was sent.</small>
                <code>{inviteLink}</code>
              </div>
              <button
                className="button button-subtle small-button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(inviteLink);
                    toast.success("Link copied.");
                  } catch {
                    toast.error(
                      "Clipboard access is unavailable; select and copy the link."
                    );
                  }
                }}
              >
                Copy link
              </button>
              <button
                className="icon-button"
                onClick={() => setInviteLink("")}
                aria-label="Dismiss invitation link"
              >
                <XCircle size={17} />
              </button>
            </div>
          )}
          <footer className="page-footer">
            Care Circle helps families share everyday coordination. It is not a
            substitute for professional medical care or emergency services.
          </footer>
        </div>
      </main>
      <CareDialog
        mode={dialog}
        members={memberOptions}
        busy={busy}
        onClose={() => setDialog(null)}
        onSubmit={submitDialog}
      />
    </div>
  );
}

function pageSubtitle(tab: Tab) {
  const subtitles: Record<Tab, string> = {
    home: "A steady place to see what’s next and who’s taking care of it.",
    tasks: "Small, clear commitments help everyone know what comes next.",
    calendar: "Keep appointments and visits visible to the whole family.",
    medications:
      "A shared family record of prescribed schedules and confirmations.",
    journal: "Leave useful context for the next person stepping in.",
    needs: "Keep a shared record of household items and who will get them.",
    contacts: "A family-entered directory for important people and services.",
    family: "The people who share access to this family space.",
    privacy: "What this first-stage app does—and what it does not do.",
  };
  return subtitles[tab];
}

function Landing({ signIn, error }: { signIn: () => void; error: string }) {
  return (
    <div className="landing-screen">
      <div className="landing-top">
        <Brand />
        <span className="landing-top-label">A calmer way to care together</span>
      </div>
      <main className="landing-main">
        <div className="landing-copy">
          <span className="eyebrow">
            <span className="status-dot dot-sage" /> FAMILY CARE, IN ONE PLACE
          </span>
          <h1>
            Care, shared
            <br />
            <em>clearly.</em>
          </h1>
          <p>
            Bring the family’s tasks, appointments, medication check-ins and
            care notes together—so everyone knows what’s next and who’s there.
          </p>
          <button
            className="button button-primary landing-cta"
            onClick={signIn}
          >
            Sign in to your family space <ArrowUpRight size={17} />
          </button>
          <small className="login-provider">
            Secure sign-in with Manus. New here? Your account is created when
            you sign in.
          </small>
          {error && <p className="inline-error">{error}</p>}
        </div>
        <div className="landing-preview">
          <div className="preview-topline">
            <span className="preview-dot" />
            <span className="preview-dot" />
            <span className="preview-dot" />
            <span>EXAMPLE ONLY · PRODUCT PREVIEW</span>
          </div>
          <div className="preview-greeting">
            <span>MONDAY, MAY 19</span>
            <h2>A little more in sync.</h2>
          </div>
          <div className="preview-task">
            <span className="preview-check">
              <Check size={13} />
            </span>
            <span>
              <strong>Pick up groceries</strong>
              <small>Today · Jordan</small>
            </span>
            <span className="preview-tag">DONE</span>
          </div>
          <div className="preview-task">
            <span className="preview-check empty" />
            <span>
              <strong>Dr. Patel · 2:30 PM</strong>
              <small>Tomorrow · Sam is going</small>
            </span>
            <span className="preview-calendar">
              <CalendarDays size={17} />
            </span>
          </div>
          <div className="preview-note">
            <span className="preview-avatar">M</span>
            <p>
              <strong>Mom seemed more rested after lunch.</strong>
              <small>Maya · 10 minutes ago</small>
            </p>
          </div>
          <div className="preview-bottom">
            <span>
              <span className="dot-small" /> Sample family members
            </span>
            <span>
              One shared circle <Heart size={13} />
            </span>
          </div>
        </div>
      </main>
      <div className="landing-values">
        <div>
          <span>01</span>
          <p>
            <strong>Know what’s next</strong>
            <small>Tasks and appointments, in one place</small>
          </p>
        </div>
        <div>
          <span>02</span>
          <p>
            <strong>Share the small stuff</strong>
            <small>Clear owners, fewer missed handoffs</small>
          </p>
        </div>
        <div>
          <span>03</span>
          <p>
            <strong>Keep the family close</strong>
            <small>A private circle for care coordination</small>
          </p>
        </div>
      </div>
      <footer className="landing-footer">
        <span>care circle</span>
        <span>For coordination, not medical advice or emergency response.</span>
      </footer>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  detail: string;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button className="stat-card" onClick={onClick}>
      <span className={`stat-icon ${tone}`}>
        <Icon size={18} />
      </span>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <span className="stat-detail">{detail}</span>
    </button>
  );
}
function PanelTitle({
  title,
  caption,
  action,
  onAction,
}: {
  title: string;
  caption?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="panel-title">
      <div>
        <h2>{title}</h2>
        {caption && <span>{caption}</span>}
      </div>
      {action && (
        <button className="text-action" onClick={onAction}>
          {action}
          <ArrowUpRight size={14} />
        </button>
      )}
    </div>
  );
}
function TaskRow({
  task,
  isOverdue,
  onEdit,
  onComplete,
  onDelete,
  showDelete = false,
  canEdit,
}: {
  task: {
    id: number;
    title: string;
    description: string | null;
    dueAt: Date | null;
    priority: string;
    assigneeId: number | null;
    createdBy: number;
    assigneeName: string | null;
    status: string;
    recurrence: string;
    notes: string | null;
    estimatedMinutes: number | null;
    completedByName: string | null;
    completedAt: Date | null;
    completionHistory: Array<{
      completedAt: Date;
      completedByName: string | null;
    }>;
  };
  isOverdue: boolean;
  onEdit: () => void;
  onComplete: () => void;
  onDelete?: () => void;
  showDelete?: boolean;
  canEdit: boolean;
}) {
  const taskCopy = (
    <>
      <strong>{task.title}</strong>
      {task.description && <small>{task.description}</small>}
      <span className="task-metadata">
        <span className={isOverdue ? "meta-overdue" : ""}>
          {isOverdue ? "Past due · " : ""}
          {shortDate(task.dueAt)}
        </span>
        <span className="meta-separator">·</span>
        <span>{task.assigneeName || "Unassigned"}</span>
        {task.recurrence !== "none" && (
          <span className="repeat-tag">Repeats {task.recurrence}</span>
        )}
        {task.estimatedMinutes != null && <span>{task.estimatedMinutes} min est.</span>}
        {task.status === "in_progress" && (
          <span className="in-progress-tag">In progress</span>
        )}
      </span>
    </>
  );
  return (
    <article
      className={`task-row ${task.status === "completed" ? "task-complete" : ""}`}
    >
      {canEdit ? (
        <button
          className={`task-check ${task.status === "completed" ? "checked" : ""}`}
          aria-label={
            task.status === "completed" ? "Reopen task" : "Mark task complete"
          }
          onClick={onComplete}
        >
          {task.status === "completed" && <Check size={13} />}
        </button>
      ) : (
        <span
          className={`task-check task-check-static ${task.status === "completed" ? "checked" : ""}`}
          role="img"
          aria-label={
            task.status === "completed" ? "Task completed" : "Task open"
          }
        >
          {task.status === "completed" && <Check size={13} />}
        </span>
      )}
      {canEdit ? (
        <button className="task-copy" onClick={onEdit}>
          {taskCopy}
        </button>
      ) : (
        <div className="task-copy">{taskCopy}</div>
      )}
      <span className={`priority-pill priority-${task.priority}`}>
        {task.priority}
      </span>
      {showDelete && onDelete && (
        <button className="text-danger task-delete" onClick={onDelete}>
          Delete
        </button>
      )}
      {task.completionHistory.length > 0 ? (
        <details className="completion-history">
          <summary>
            Completion history ({task.completionHistory.length})
          </summary>
          <ul>
            {task.completionHistory.map((completion, index) => (
              <li key={`${completion.completedAt.toISOString()}-${index}`}>
                {completion.completedByName || "A family member"} ·{" "}
                {dateTime(completion.completedAt)}
              </li>
            ))}
          </ul>
        </details>
      ) : task.completedAt ? (
        <span className="completion-meta">
          {task.status === "completed" ? "Completed" : "Last completed"} by{" "}
          {task.completedByName || "a family member"} ·{" "}
          {dateTime(task.completedAt)}
        </span>
      ) : null}
    </article>
  );
}
function JournalEntry({
  note,
  compact = false,
}: {
  note: {
    id: number;
    kind: string;
    body: string;
    isConfirmedFact: boolean;
    createdAt: Date;
    authorName: string | null;
  };
  compact?: boolean;
}) {
  const labels: Record<string, string> = {
    update: "CARE UPDATE",
    visit_note: "VISIT NOTE",
    question: "QUESTION FOR THE CLINICIAN",
    handoff: "CARE HANDOFF",
    need: "FAMILY NEED",
  };
  return (
    <article
      className={`journal-entry ${compact ? "journal-entry-compact" : ""}`}
    >
      <span className="journal-marker" />
      <div className="journal-entry-content">
        <div className="journal-meta">
          <span>{labels[note.kind] || "CARE UPDATE"}</span>
          {note.isConfirmedFact && (
            <span className="fact-mark">
              <CheckCircle2 size={12} /> CONFIRMED FACT
            </span>
          )}
        </div>
        <p>{note.body}</p>
        <div className="journal-author">
          <Avatar name={note.authorName} />
          <span>{note.authorName || "Family member"}</span>
          <span>·</span>
          <time>{dateTime(note.createdAt)}</time>
        </div>
      </div>
    </article>
  );
}
