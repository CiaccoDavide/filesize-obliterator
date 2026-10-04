import { useEffect, useId, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { formatBytes } from "../intake/formatBytes";
import {
  formatImageMeta,
  localAssetUrl,
  previewKey,
} from "../preview/imagePreview";

export type ImageCompareTarget = {
  sourcePath: string;
  outputPath: string;
  originalBytes?: number;
  resultBytes?: number;
};

type Props = {
  target: ImageCompareTarget;
  onClose: () => void;
};

type Dims = { w: number; h: number } | null;

function Pane({
  label,
  path,
  bytes,
  dims,
  onDims,
}: {
  label: string;
  path: string;
  bytes: number | undefined;
  dims: Dims;
  onDims: (d: Dims) => void;
}) {
  const src = useMemo(() => localAssetUrl(path, convertFileSrc), [path]);
  const meta = formatImageMeta(dims?.w ?? null, dims?.h ?? null, bytes, formatBytes);

  return (
    <div className="preview-pane">
      <p className="panel-label">{label}</p>
      <div className="preview-frame">
        <img
          className="preview-img"
          src={src}
          alt={label}
          onLoad={(e) => {
            const img = e.currentTarget;
            onDims({ w: img.naturalWidth, h: img.naturalHeight });
          }}
        />
      </div>
      <p className="preview-meta mono" title={path}>
        {meta}
      </p>
      <p className="preview-path mono" title={path}>
        {path}
      </p>
    </div>
  );
}

/**
 * Ice HUD offline compare overlay for a successful image compress job.
 * Loads both panes via Tauri asset URLs — no remote hosts.
 */
export function ImageComparePreview({ target, onClose }: Props) {
  const titleId = useId();
  const key = previewKey(target.sourcePath, target.outputPath);
  const [originalDims, setOriginalDims] = useState<Dims>(null);
  const [outputDims, setOutputDims] = useState<Dims>(null);
  const [wipe, setWipe] = useState(50);

  useEffect(() => {
    setOriginalDims(null);
    setOutputDims(null);
    setWipe(50);
  }, [key]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const originalSrc = useMemo(
    () => localAssetUrl(target.sourcePath, convertFileSrc),
    [target.sourcePath],
  );
  const outputSrc = useMemo(
    () => localAssetUrl(target.outputPath, convertFileSrc),
    [target.outputPath],
  );

  return (
    <div
      className="preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="image-compare-preview"
      data-preview-key={key}
    >
      <div className="preview-scrim" onClick={onClose} aria-hidden="true" />
      <div className="hud-frame preview-panel">
        <div className="preview-head">
          <p className="panel-label" id={titleId}>
            Image compare
          </p>
          <button type="button" className="btn" onClick={onClose}>
            CLOSE
          </button>
        </div>

        <div className="preview-panes">
          <Pane
            label="Original"
            path={target.sourcePath}
            bytes={target.originalBytes}
            dims={originalDims}
            onDims={setOriginalDims}
          />
          <Pane
            label="Compressed"
            path={target.outputPath}
            bytes={target.resultBytes}
            dims={outputDims}
            onDims={setOutputDims}
          />
        </div>

        <div className="preview-wipe hud-frame">
          <p className="panel-label">Wipe</p>
          <div className="preview-wipe-stage">
            <img
              className="preview-wipe-base"
              src={originalSrc}
              alt=""
              aria-hidden="true"
            />
            <img
              className="preview-wipe-top"
              src={outputSrc}
              alt=""
              aria-hidden="true"
              style={{ clipPath: `inset(0 ${100 - wipe}% 0 0)` }}
            />
            <div
              className="preview-wipe-guide"
              style={{ left: `${wipe}%` }}
              aria-hidden="true"
            />
          </div>
          <label className="preview-wipe-control">
            <span className="meter-label">Reveal compressed</span>
            <input
              type="range"
              min={0}
              max={100}
              value={wipe}
              onChange={(e) => setWipe(Number(e.target.value))}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={wipe}
            />
            <span className="mono meter-value">{wipe}%</span>
          </label>
        </div>
      </div>
    </div>
  );
}
