export function Stamp({
  verdict,
  className = "",
}: {
  verdict: "approved" | "rejected" | "paid";
  className?: string;
}) {
  const isPass = verdict === "approved" || verdict === "paid";
  const label = verdict === "paid" ? "PAID" : isPass ? "PASS" : "FAIL";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-xs font-bold uppercase tracking-widest animate-stampIn ${
        isPass
          ? "bg-volt/15 text-volt"
          : "bg-coral/10 text-coral"
      } ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isPass ? "bg-volt" : "bg-coral"}`} />
      {label}
    </span>
  );
}
