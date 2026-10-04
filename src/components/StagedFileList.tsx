import { formatBytes } from "../intake/formatBytes";
import type { StagedFile } from "../intake/types";
import type { RevealAction } from "../reveal/actions";
import { RevealRowActions } from "./RevealRowActions";

type Props = {
  files: StagedFile[];
  onReveal?: (action: RevealAction, targets: { sourcePath: string }) => void;
};

export function StagedFileList({ files, onReveal }: Props) {
  if (files.length === 0) {
    return (
      <p className="staged-empty mono">No files staged.</p>
    );
  }

  return (
    <ul className="staged-list">
      {files.map((file) => (
        <li key={file.id} className="staged-row">
          <span className="staged-kind">{file.kind}</span>
          <span className="staged-path mono" title={file.path}>
            {file.path}
          </span>
          <span className="staged-preset mono" title={file.presetId || "unset"}>
            {file.presetId || "—"}
          </span>
          <span className="staged-size mono">{formatBytes(file.bytes)}</span>
          {onReveal ? (
            <RevealRowActions
              targets={{ sourcePath: file.path }}
              showOutput={false}
              onReveal={(action) =>
                onReveal(action, { sourcePath: file.path })
              }
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
