import { useEffect, useRef } from 'react';

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog__head">
          <h2 id="help-title">Hoe werkt het?</h2>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Sluiten">
            ×
          </button>
        </div>
        <ol className="steps">
          <li>Kies wat je wilt maken: een cookie cutter of een vulvorm.</li>
          <li>Upload je SVG-bestand.</li>
          <li>Klik op <strong>Start</strong>.</li>
          <li>Bekijk je 3D-model: draai het met je muis of vinger.</li>
          <li>Download de STL en open die in je slicer.</li>
        </ol>

        <h3>Een SVG maken in Canva</h3>
        <ol className="steps">
          <li>Maak een ontwerp met een eigen formaat van <strong>100 × 100 mm</strong>.</li>
          <li>
            Plaats een gesloten vorm in het frame: een gevulde vorm of een dikke, gesloten rand. Lijnen of vormen binnenin
            kun je na het uploaden als stempeldetail kiezen.
          </li>
          <li>Gebruik geen foto's, rasterafbeeldingen, tekst of achtergrondvormen.</li>
          <li>Kies <em>Delen → Downloaden → SVG</em> en vink <em>Transparante achtergrond</em> aan als die optie er is.</li>
          <li>Upload het bestand hier en klik op Start.</li>
        </ol>

        <h3>Hoe groot wordt mijn vorm?</h3>
        <p>
          Het volledige Canva-frame komt overeen met 100 × 100 mm. Een vorm die 60% van de breedte van het frame
          beslaat, wordt dus 60 mm breed. In <strong>Expert</strong> stel je zelf de afmetingen van het volledige frame in.
        </p>

        <h3>Goed om te weten</h3>
        <ul className="bullets">
          <li>Alles gebeurt in je browser: je bestand wordt nergens naartoe gestuurd.</li>
          <li>
            Of een cookie cutter geschikt is voor contact met voedsel, hangt af van onder meer het printmateriaal,
            de printmethode en hoe je hem reinigt.
          </li>
        </ul>
      </div>
    </div>
  );
}
