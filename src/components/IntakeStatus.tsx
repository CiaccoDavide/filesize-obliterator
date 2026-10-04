type Props = {
  status: string;
  tone?: "ok" | "warn" | "danger";
};

export function IntakeStatus({ status, tone = "ok" }: Props) {
  return (
    <p className={`intake-status tone-${tone}`} role="status" aria-live="polite">
      <span className="hud-tick" aria-hidden="true" />
      {status}
    </p>
  );
}
