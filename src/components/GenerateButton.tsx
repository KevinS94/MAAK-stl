interface GenerateButtonProps {
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}

export function GenerateButton({ busy, disabled, onClick }: GenerateButtonProps) {
  return (
    <button type="button" className="btn btn--primary btn--large" onClick={onClick} disabled={disabled || busy} aria-busy={busy}>
      {busy ? (
        <>
          <span className="spinner spinner--light" aria-hidden="true" /> Model wordt gemaakt…
        </>
      ) : (
        'Start'
      )}
    </button>
  );
}
