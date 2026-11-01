import type { ReactNode } from "react";

export const buttonClass =
  "inline-flex items-center justify-center rounded-md bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50";

export const buttonSecondaryClass =
  "inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50";

export const fieldClass =
  "mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900";

export const labelClass = "block text-sm font-medium text-zinc-800";

export function PageHeader({ title, lede }: { title: string; lede?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{title}</h1>
      {lede ? <p className="mt-1 max-w-2xl text-sm text-zinc-600">{lede}</p> : null}
    </header>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return <p className="text-sm text-zinc-500">{label}…</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-zinc-600">{children}</p>;
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="text-sm text-red-700" role="alert">
      {message}
    </p>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">{children}</div>;
}
