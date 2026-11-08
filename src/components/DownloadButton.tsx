interface DownloadButtonProps {
  fileName: string;
  disabled?: boolean;
  onDownload: () => void;
}

export function DownloadButton({ fileName, disabled, onDownload }: DownloadButtonProps) {
  return (
    <div className="download">
      <button type="button" className="btn btn--secondary btn--large" onClick={onDownload} disabled={disabled}>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path d="M10 3v10m0 0-4-4m4 4 4-4M4 16h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Download STL
      </button>
      <span className="download__name">{fileName}</span>
    </div>
  );
}
