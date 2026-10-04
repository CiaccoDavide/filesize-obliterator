import { useEffect, useId, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { formatBytes } from "../intake/formatBytes";
import { previewAllowAssets } from "../ipc/preview";
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
  assetReady,
}: {
  label: string;
  path: string;
  bytes: number | undefined;
  dims: Dims;
  onDims: (d: Dims) => void;
  assetReady: boolean;
}) {
  const [loadError, setLoadError] = useState(false);
  const src = useMemo(() => {
    if (!assetReady) return "";
    try {
      return localAssetUrl(path, convertFileSrc);
    } catch {
      return "";
    }
  }, [assetReady, path]);
  const meta = formatImageMeta(dims?.w ?? null, dims?.h ?? null, bytes, formatBytes);

  useEffect(() => {
    setLoadError(false);
  }, [path, assetReady]);

  const showFail = assetReady && (loadError || !src);

  return (
    <div className="preview-pane">
      <p className="panel-label">{label}</p>
      <div className="preview-frame">
        {showFail ? (
          <p className="preview-status tone-danger" role="status">
            LOAD FAIL
          </p>
        ) : src ? (
          <img
            className="preview-img"
            src={src}
            alt={label}
            onLoad={(e) => {
              const img = e.currentTarget;
              setLoadError(false);
              onDims({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => {
              setLoadError(true);
              onDims(null);
            }}
          />
        ) : null}
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
  const [assetReady, setAssetReady] = useState(false);
  const [scopeError, setScopeError] = useState(false);
  const [wipeError, setWipeError] = useState(false);

  useEffect(() => {
    setOriginalDims(null);
    setOutputDims(null);
    setWipe(50);
    setAssetReady(false);
    setScopeError(false);
    setWipeError(false);
    let cancelled = false;
    void previewAllowAssets(target.sourcePath, target.outputPath)
      .then(() => {
        if (!cancelled) setAssetReady(true);
      })
      .catch(() => {
        if (!cancelled) setScopeError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key, target.sourcePath, target.outputPath]);

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

  const originalSrc = useMemo(() => {
    if (!assetReady) return "";
    try {
      return localAssetUrl(target.sourcePath, convertFileSrc);
    } catch {
      return "";
    }
  }, [assetReady, target.sourcePath]);
  const outputSrc = useMemo(() => {
    if (!assetReady) return "";
    try {
      return localAssetUrl(target.outputPath, convertFileSrc);
    } catch {
      return "";
    }
  }, [assetReady, target.outputPath]);

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

        {scopeError ? (
          <p className="preview-status tone-danger" role="status">
            SCOPE DENIED
          </p>
        ) : null}

        <div className="preview-panes">
          <Pane
            label="Original"
            path={target.sourcePath}
            bytes={target.originalBytes}
            dims={originalDims}
            onDims={setOriginalDims}
            assetReady={assetReady && !scopeError}
          />
          <Pane
            label="Compressed"
            path={target.outputPath}
            bytes={target.resultBytes}
            dims={outputDims}
            onDims={setOutputDims}
            assetReady={assetReady && !scopeError}
          />
        </div>

        <div className="preview-wipe hud-frame">
          <p className="panel-label">Wipe</p>
          {assetReady && (wipeError || !originalSrc || !outputSrc) ? (
            <p className="preview-status tone-danger" role="status">
              LOAD FAIL
            </p>
          ) : originalSrc && outputSrc ? (
            <div className="preview-wipe-stage">
              <img
                className="preview-wipe-base"
                src={originalSrc}
                alt=""
                aria-hidden="true"
                onError={() => setWipeError(true)}
              />
              <img
                className="preview-wipe-top"
                src={outputSrc}
                alt=""
                aria-hidden="true"
                style={{ clipPath: `inset(0 ${100 - wipe}% 0 0)` }}
                onError={() => setWipeError(true)}
              />
              <div
                className="preview-wipe-guide"
                style={{ left: `${wipe}%` }}
                aria-hidden="true"
              />
            </div>
          ) : (
            <div className="preview-wipe-stage" aria-hidden="true" />
          )}
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
