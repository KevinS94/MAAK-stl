interface HeaderProps {
  onHelp: () => void;
}

/** Vervang `public/logo.svg` door het officiële MAAK!-logo; de rest past zich aan. */
const LOGO_SRC = `${import.meta.env.BASE_URL}logo.svg`;

export function Header({ onHelp }: HeaderProps) {
  return (
    <header className="header">
      <div className="header__brand">
        <img className="header__logo" src={LOGO_SRC} alt="MAAK!" width={96} height={32} />
        <span className="header__divider" aria-hidden="true" />
        <span className="header__product">Shape to STL</span>
      </div>
      <button type="button" className="header__help" onClick={onHelp} aria-haspopup="dialog" aria-label="Help">
        <span aria-hidden="true" className="header__help-icon">?</span>
        <span>Help</span>
      </button>
    </header>
  );
}
