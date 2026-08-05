import { ButtonHTMLAttributes, AnchorHTMLAttributes } from "react";

type Variant = "volt" | "ink" | "ghost";

const base =
  "inline-flex items-center justify-center gap-2 rounded-sharp px-5 py-2.5 text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]";

const variants: Record<Variant, string> = {
  volt: "bg-accent text-white shadow-stamp hover:bg-accent/90",
  ink: "bg-ink text-white shadow-stamp hover:bg-ink-2",
  ghost: "bg-transparent text-ink-60 hover:bg-paper-2 hover:text-ink",
};

export function Button({
  variant = "volt",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function LinkButton({
  variant = "volt",
  className = "",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant }) {
  return <a className={`${base} ${variants[variant]} ${className}`} {...props} />;
}
