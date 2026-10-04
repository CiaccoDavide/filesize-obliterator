import type { MediaKind, PresetInfo } from "../ipc/compress";
import type { PresetByKind } from "../presets/selection";

type Props = {
  kinds: MediaKind[];
  byKind: Record<MediaKind, PresetInfo[]>;
  selected: PresetByKind;
  onSelect: (kind: MediaKind, presetId: string) => void;
  disabled?: boolean;
};

export function PresetPicker({
  kinds,
  byKind,
  selected,
  onSelect,
  disabled = false,
}: Props) {
  if (kinds.length === 0) {
    return (
      <div className="hud-frame preset-panel">
        <p className="panel-label">Presets</p>
        <p className="preset-empty mono">Stage files to arm presets.</p>
      </div>
    );
  }

  return (
    <div className="hud-frame preset-panel">
      <p className="panel-label">Presets</p>
      <div className="preset-kinds">
        {kinds.map((kind) => {
          const options = byKind[kind] ?? [];
          const activeId = selected[kind] ?? "";
          const active = options.find((p) => p.id === activeId);
          return (
            <div key={kind} className="preset-kind-block">
              <p className="panel-label">{kind}</p>
              {options.length === 0 ? (
                <p className="preset-empty mono">No presets for {kind}.</p>
              ) : (
                <>
                  <div
                    className="preset-options"
                    role="listbox"
                    aria-label={`${kind} preset`}
                    aria-disabled={disabled || undefined}
                  >
                    {options.map((preset) => {
                      const isActive = preset.id === activeId;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          className={`preset-option${isActive ? " is-active" : ""}`}
                          disabled={disabled}
                          title={preset.description}
                          onClick={() => onSelect(kind, preset.id)}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                  {active ? (
                    <p className="preset-desc mono">{active.description}</p>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
