import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { MediaKind, PresetInfo } from "../ipc/compress";
import type { PresetByKind } from "../presets/selection";

type Props = {
  kinds: MediaKind[];
  byKind: Record<MediaKind, PresetInfo[]>;
  selected: PresetByKind;
  onSelect: (kind: MediaKind, presetId: string) => void;
  disabled?: boolean;
};

type KindListboxProps = {
  kind: MediaKind;
  options: PresetInfo[];
  activeId: string;
  disabled: boolean;
  onSelect: (kind: MediaKind, presetId: string) => void;
};

function indexForId(options: PresetInfo[], id: string): number {
  const i = options.findIndex((p) => p.id === id);
  return i >= 0 ? i : 0;
}

/** Single-select listbox with APG roving tabindex + arrow keys. */
function KindPresetListbox({
  kind,
  options,
  activeId,
  disabled,
  onSelect,
}: KindListboxProps) {
  const baseId = useId();
  const [focusIndex, setFocusIndex] = useState(() =>
    indexForId(options, activeId),
  );
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    setFocusIndex(indexForId(options, activeId));
  }, [activeId, options]);

  function moveFocus(next: number) {
    if (disabled || options.length === 0) return;
    const clamped = Math.max(0, Math.min(options.length - 1, next));
    setFocusIndex(clamped);
    onSelect(kind, options[clamped]!.id);
    queueMicrotask(() => optionRefs.current[clamped]?.focus());
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled || options.length === 0) return;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        e.preventDefault();
        moveFocus((focusIndex + 1) % options.length);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault();
        moveFocus((focusIndex - 1 + options.length) % options.length);
        break;
      case "Home":
        e.preventDefault();
        moveFocus(0);
        break;
      case "End":
        e.preventDefault();
        moveFocus(options.length - 1);
        break;
      case " ":
      case "Enter":
        e.preventDefault();
        onSelect(kind, options[focusIndex]!.id);
        break;
      default:
        break;
    }
  }

  return (
    <div
      className="preset-options"
      role="listbox"
      aria-label={`${kind} preset`}
      aria-disabled={disabled || undefined}
      onKeyDown={handleKeyDown}
    >
      {options.map((preset, i) => {
        const isActive = preset.id === activeId;
        const isFocused = i === focusIndex;
        return (
          <div
            key={preset.id}
            id={`${baseId}-${preset.id}`}
            ref={(el) => {
              optionRefs.current[i] = el;
            }}
            role="option"
            aria-selected={isActive}
            tabIndex={disabled ? -1 : isFocused ? 0 : -1}
            className={`preset-option${isActive ? " is-active" : ""}${
              disabled ? " is-disabled" : ""
            }`}
            title={preset.description}
            onClick={() => {
              if (disabled) return;
              setFocusIndex(i);
              onSelect(kind, preset.id);
            }}
          >
            {preset.label}
          </div>
        );
      })}
    </div>
  );
}

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
    <div className="hud-frame preset-panel" data-testid="preset-picker">
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
                  <KindPresetListbox
                    kind={kind}
                    options={options}
                    activeId={activeId}
                    disabled={disabled}
                    onSelect={onSelect}
                  />
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
