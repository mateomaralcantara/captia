"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  addMemberAction,
  createOrganizationAction,
  enrollStartAction,
  enrollVerifyAction,
  loginAction,
  mfaVerifyAction,
  removeMemberAction,
  updateMemberAction,
  updateOrganizationAction,
  type ActionState,
} from "@/app/actions";
import { errorMessage, type Dictionary } from "@/lib/i18n";
import { ErrorNote } from "./ui";

const initial: ActionState = {};

function Submit({ children, className = "btn" }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {children}
    </button>
  );
}

function loginError(t: Dictionary, code?: string) {
  if (code === "not_configured") return t.login.notConfigured;
  if (code === "unreachable") return t.login.unreachable;
  if (code === "invalidCode") return t.login.invalidCode;
  return code ? t.login.invalid : null;
}

export function LoginForm({ t }: { t: Dictionary }) {
  const [state, action] = useActionState(loginAction, initial);
  const error = loginError(t, state.error);
  return (
    <form action={action} className="space-y-4">
      {error ? <ErrorNote message={error} /> : null}
      <div>
        <label className="label" htmlFor="email">{t.common.email}</label>
        <input className="input" id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div>
        <label className="label" htmlFor="password">{t.login.password}</label>
        <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Submit className="btn w-full">{t.login.submit}</Submit>
    </form>
  );
}

export function MfaForm({ t }: { t: Dictionary }) {
  const [state, action] = useActionState(mfaVerifyAction, initial);
  return (
    <form action={action} className="space-y-4">
      {state.error ? <ErrorNote message={t.login.invalidCode} /> : null}
      <div>
        <label className="label" htmlFor="code">{t.login.code}</label>
        <input className="input tracking-[0.4em]" id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />
      </div>
      <Submit className="btn w-full">{t.login.verify}</Submit>
    </form>
  );
}

export function EnrollMfa({ t }: { t: Dictionary }) {
  const [factor, setFactor] = useState<Record<string, string> | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [state, action] = useActionState(enrollVerifyAction, initial);

  if (state.ok) return <p className="text-sm text-emerald-700 dark:text-emerald-300">{t.security.mfaOn}</p>;
  if (!factor) {
    return (
      <div className="space-y-3">
        {startError ? <ErrorNote message={errorMessage(t, startError)} /> : null}
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const result = await enrollStartAction();
            if (result.data) setFactor(result.data);
            else setStartError(result.error ?? "generic");
          }}
        >
          {t.security.enroll}
        </button>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">{t.security.scan}</p>
      {/* El QR lo genera Supabase Auth como imagen SVG en data URI. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={factor.qr} alt="QR TOTP" className="h-44 w-44 rounded bg-white p-2" />
      <p className="text-xs text-slate-500">
        {t.security.secret}: <code className="break-all">{factor.secret}</code>
      </p>
      <input type="hidden" name="factorId" value={factor.factorId} />
      {state.error ? <ErrorNote message={t.login.invalidCode} /> : null}
      <div className="max-w-xs">
        <label className="label" htmlFor="enroll-code">{t.login.code}</label>
        <input className="input" id="enroll-code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required />
      </div>
      <Submit>{t.login.verify}</Submit>
    </form>
  );
}

export function CreateOrganizationForm({ t }: { t: Dictionary }) {
  const [state, action] = useActionState(createOrganizationAction, initial);
  // Misma clave mientras se reintenta tras un error (idempotente); clave nueva tras crear con éxito.
  const [firstKey] = useState(() => crypto.randomUUID());
  const key = state.data?.nextKey ?? firstKey;
  return (
    <form action={action} className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
      <input type="hidden" name="idempotencyKey" value={key} />
      <div>
        <label className="label" htmlFor="org-name">{t.common.name}</label>
        <input className="input" id="org-name" name="name" required minLength={2} maxLength={120} />
      </div>
      <div>
        <label className="label" htmlFor="org-slug">{t.customers.slug}</label>
        <input className="input" id="org-slug" name="slug" required pattern="[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?" placeholder="empresa-001" />
      </div>
      <Submit>{t.common.create}</Submit>
      <label className="flex items-center gap-2 text-sm md:col-span-3">
        <input type="checkbox" name="addCreatorAsMember" defaultChecked /> {t.customers.addMe}
      </label>
      {state.error ? <div className="md:col-span-3"><ErrorNote message={errorMessage(t, state.error)} /></div> : null}
    </form>
  );
}

export function OrganizationStatusForm({ t, organizationId, status }: { t: Dictionary; organizationId: string; status: string }) {
  const [state, action] = useActionState(updateOrganizationAction, initial);
  const next = status === "active" ? "suspended" : "active";
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (next === "suspended" && !confirm(t.common.confirmSuspend)) e.preventDefault();
      }}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="status" value={next} />
      <Submit className={next === "suspended" ? "btn-danger" : "btn-secondary"}>
        {next === "suspended" ? t.common.suspend : t.common.reactivate}
      </Submit>
      {state.error ? <ErrorNote message={errorMessage(t, state.error)} /> : null}
    </form>
  );
}

export function AddMemberForm({ t, organizationId, roles }: { t: Dictionary; organizationId: string; roles: { key: string; name: string }[] }) {
  const [state, action] = useActionState(addMemberAction, initial);
  return (
    <form action={action} className="grid gap-3 md:grid-cols-[2fr_1fr_auto] md:items-end">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div>
        <label className="label" htmlFor="member-email">{t.common.email}</label>
        <input className="input" id="member-email" name="email" type="email" required />
      </div>
      <div>
        <label className="label" htmlFor="member-role">{t.common.role}</label>
        <select className="input" id="member-role" name="roleKey" defaultValue="user">
          {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
        </select>
      </div>
      <Submit>{t.customers.addMember}</Submit>
      <label className="flex items-center gap-2 text-sm md:col-span-3">
        <input type="checkbox" name="invite" /> {t.customers.invite}
      </label>
      {state.error ? <div className="md:col-span-3"><ErrorNote message={errorMessage(t, state.error)} /></div> : null}
    </form>
  );
}

export function MemberActions({
  t, organizationId, memberId, roleKey, status, roles, canManage,
}: {
  t: Dictionary; organizationId: string; memberId: string; roleKey: string; status: string;
  roles: { key: string; name: string }[]; canManage: boolean;
}) {
  const [updateState, update] = useActionState(updateMemberAction, initial);
  const [removeState, remove] = useActionState(removeMemberAction, initial);
  if (!canManage) return null;
  const error = updateState.error ?? removeState.error;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={update} className="flex items-center gap-2">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="memberId" value={memberId} />
        <label className="sr-only" htmlFor={`role-${memberId}`}>{t.common.role}</label>
        <select
          key={roleKey}
          id={`role-${memberId}`}
          name="roleKey"
          defaultValue={roleKey}
          className="input w-auto py-1"
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        >
          {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
        </select>
      </form>
      <form action={update}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="memberId" value={memberId} />
        <input type="hidden" name="status" value={status === "active" ? "suspended" : "active"} />
        <Submit className="btn-secondary">{status === "active" ? t.common.suspend : t.common.reactivate}</Submit>
      </form>
      <form
        action={remove}
        onSubmit={(e) => {
          if (!confirm(t.common.confirmRemove)) e.preventDefault();
        }}
      >
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="memberId" value={memberId} />
        <Submit className="btn-danger">{t.common.remove}</Submit>
      </form>
      {error ? <ErrorNote message={errorMessage(t, error)} /> : null}
    </div>
  );
}
