import { formatBytes } from "../intake/formatBytes";
import type { StagedFile } from "../intake/types";

type Props = {
  files: StagedFile[];
};

export function StagedFileList({ files }: Props) {
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
        </li>
      ))}
    </ul>
  );
}
