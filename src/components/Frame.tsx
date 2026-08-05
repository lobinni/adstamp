import { ReactNode } from "react";

export function Frame({
  children,
  className = "",
  as: Tag = "div",
  id,
}: {
  children: ReactNode;
  className?: string;
  as?: keyof React.JSX.IntrinsicElements;
  id?: string;
}) {
  const Component = Tag as React.ElementType;
  return (
    <Component
      id={id}
      className={`rounded-sharp border border-ink/10 bg-paper shadow-stamp ${className}`}
    >
      {children}
    </Component>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-xs font-bold uppercase tracking-widest text-accent">
      {children}
    </div>
  );
}
