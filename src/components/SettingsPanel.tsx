import {
  MAX_CONCURRENCY,
  MIN_CONCURRENCY,
  type AppSettings,
  type UiDensity,
} from "../settings/schema";

type Props = {
  settings: AppSettings;
  disabled?: boolean;
  /** Offline probe result: `HW: READY` or `HW: UNAVAILABLE`. */
  hwStatus?: string | null;
  onConcurrency: (n: number) => void;
  onStripMetadata: (on: boolean) => void;
  onPreferHardware: (on: boolean) => void;
  onUiDensity: (density: UiDensity) => void;
};

export function SettingsPanel({
  settings,
  disabled = false,
  hwStatus = null,
  onConcurrency,
  onStripMetadata,
  onPreferHardware,
  onUiDensity,
}: Props) {
  return (
    <div className="hud-frame setup-surface" data-testid="settings-panel">
      <p className="panel-label">Settings</p>
      <p className="hud-toggle-hint">Local only — stored on this machine.</p>

      <label className="hud-toggle">
        <span className="hud-toggle-label">Concurrency</span>
        <input
          type="range"
          min={MIN_CONCURRENCY}
          max={MAX_CONCURRENCY}
          step={1}
          value={settings.concurrency}
          disabled={disabled}
          onChange={(e) => onConcurrency(Number(e.target.value))}
          aria-label="Queue concurrency"
        />
        <span className="mono hud-toggle-state">{settings.concurrency}</span>
      </label>
      <p className="hud-toggle-hint">
        Parallel encode workers (1–{MAX_CONCURRENCY}). Applied to the queue.
      </p>

      <label className="hud-toggle">
        <input
          type="checkbox"
          checked={settings.stripMetadata}
          disabled={disabled}
          onChange={(e) => onStripMetadata(e.target.checked)}
        />
        <span className="hud-toggle-label">Strip metadata</span>
        <span className="mono hud-toggle-state">
          {settings.stripMetadata ? "ON" : "OFF"}
        </span>
      </label>
      <p className="hud-toggle-hint">
        {settings.stripMetadata
          ? "EXIF/GPS removed on image/video outputs."
          : "Preserve orientation and tags where the pipeline allows."}
      </p>
      <p
        className="hud-toggle-hint mono"
        data-testid="strip-metadata-payload"
      >
        compress_start.stripMetadata={String(settings.stripMetadata)}
      </p>

      <label className="hud-toggle">
        <input
          type="checkbox"
          checked={settings.preferHardware}
          disabled={disabled}
          onChange={(e) => onPreferHardware(e.target.checked)}
        />
        <span className="hud-toggle-label">Prefer hardware</span>
        <span className="mono hud-toggle-state">
          {settings.preferHardware ? "ON" : "OFF"}
        </span>
      </label>
      <p className="hud-toggle-hint">
        {settings.preferHardware
          ? "Use VideoToolbox / NVENC / QSV / AMF when a local ffmpeg HW session can init; soft-fallback to libx264."
          : "Always encode video with software libx264."}
      </p>
      <p
        className="hud-toggle-hint mono"
        data-testid="prefer-hardware-payload"
      >
        compress_start.preferHardware={String(settings.preferHardware)}
      </p>
      <p
        className="hud-toggle-hint mono"
        data-testid="hw-encode-status"
        role="status"
      >
        {hwStatus ?? "HW: —"}
      </p>

      <div className="settings-density" role="group" aria-label="UI density">
        <p className="hud-toggle-label">Density</p>
        <div className="preset-options">
          {(["compact", "regular"] as const).map((density) => (
            <button
              key={density}
              type="button"
              className={
                settings.uiDensity === density
                  ? "preset-option is-selected"
                  : "preset-option"
              }
              disabled={disabled}
              onClick={() => onUiDensity(density)}
            >
              {density}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
