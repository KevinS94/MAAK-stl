# MAAK! Shape to STL

**MAAK! Shape to STL** is een gratis, laagdrempelige webapplicatie die een eenvoudige SVG (bijvoorbeeld geëxporteerd uit Canva) omzet naar een 3D-printbaar STL-bestand. Er is geen CAD-kennis nodig:

1. Kies wat je wilt maken.
2. Upload een SVG-bestand.
3. Klik op **Start**.
4. Bekijk het 3D-model.
5. Download de STL.

Er zijn twee generators:

| Generator | Wat het maakt | Standaard (Basis) |
|---|---|---|
| **Cookie cutter** | Koekjesuitsteker met een dunne verticale snijwand en bovenaan een naar buiten verbrede drukrand | kader 100 × 100 mm · hoogte 15 mm · wand 1,2 mm · drukrand +2 mm over de bovenste 3 mm |
| **Vulvorm** | Hol bakje in de vorm van de SVG, met gesloten bodem en opstaande wanden | kader 100 × 100 mm · hoogte 20 mm · wand 2 mm · bodem 2 mm |

Alles gebeurt **lokaal in de browser**: geen backend, geen database, geen accounts, geen externe API's. Je bestand verlaat je toestel nooit. Eens de pagina geladen is, werkt de app ook zonder internetverbinding.

> **Voedselveiligheid.** Of een geprinte cookie cutter geschikt is voor contact met voedsel, hangt onder meer af van het gekozen printmateriaal, de printmethode (FDM-lagen houden makkelijk resten vast) en het reinigen. MAAK! Shape to STL maakt enkel de vorm.

---

## Inhoud

- [Hoe maak je een SVG in Canva?](#hoe-maak-je-een-svg-in-canva)
- [Technologie](#technologie)
- [Installatie en lokaal starten](#installatie-en-lokaal-starten)
- [Build en tests](#build-en-tests)
- [Publiceren op GitHub Pages](#publiceren-op-github-pages)
- [Hoe de SVG-schaal werkt](#hoe-de-svg-schaal-werkt)
- [Ondersteunde SVG's](#ondersteunde-svgs)
- [Hoe de geometrie gemaakt wordt](#hoe-de-geometrie-gemaakt-wordt)
- [Beperkingen van versie 1](#beperkingen-van-versie-1)
- [Projectstructuur](#projectstructuur)
- [Een nieuwe generator toevoegen](#een-nieuwe-generator-toevoegen)
- [Standaardparameters wijzigen](#standaardparameters-wijzigen)
- [Het MAAK!-logo vervangen](#het-maak-logo-vervangen)

---

## Hoe maak je een SVG in Canva?

1. Maak een ontwerp met een eigen formaat van **100 × 100 mm**.
2. Plaats **één eenvoudige, gesloten, gevulde vectorvorm** in het frame (bijvoorbeeld een element uit *Vormen*).
3. Gebruik **geen** rasterafbeeldingen (foto's), tekst, lijnen of **achtergrondvormen**.
4. Exporteer via *Delen → Downloaden → Bestandstype: SVG*. Vink *Transparante achtergrond* aan als die optie beschikbaar is (Canva Pro), zodat er geen achtergrondrechthoek in het bestand komt.
5. Upload het bestand in MAAK! Shape to STL.
6. Klik op **Start** en download je STL.

**Achtergrond meegeëxporteerd?** Een vorm die het volledige frame bedekt (≥ 98 % van breedte én hoogte) wordt automatisch als achtergrond herkend en genegeerd, met een melding. Een egale achtergrondkleur instellen in Canva en die bij export uitschakelen blijft de veiligste werkwijze.

---

## Technologie

| Onderdeel | Gebruikt |
|---|---|
| UI | React 19 (functionele componenten en hooks), TypeScript 5.9 (`strict`) |
| Build | Vite 8 |
| 3D-weergave | Three.js 0.187 met `OrbitControls` |
| SVG-interpretatie | Three.js `SVGLoader` (na eigen veiligheidscontrole) |
| STL-export | Three.js `STLExporter` (binary) |
| 2D-polygonbewerkingen | [clipper2-ts](https://github.com/countertype/clipper2-ts) 2.0.1-18 — unions, intersecties, offsets, vereenvoudiging |
| Triangulatie | Earcut (via Three.js `ShapeUtils`) met eigen herstel van T-verbindingen; Clipper2 constrained Delaunay als terugvaloptie |
| Tests | Vitest 5 + jsdom + Testing Library; Playwright 1.62 voor de browser-smoketest |
| Hosting | GitHub Pages via GitHub Actions |

Er zijn geen betaalde diensten, geen externe CAD-software en geen server-side verwerking.

---

## Installatie en lokaal starten

Vereist: **Node.js 20.19 of nieuwer** (getest met Node 24).

```bash
npm install
npm run dev
```

Open daarna het adres dat Vite toont (standaard <http://localhost:5173/>).

---

## Build en tests

```bash
npm run typecheck   # TypeScript-controle (strict)
npm test            # unit-, geometrie- en functionele tests (Vitest)
npm run build       # typecheck + productiebuild in dist/
npm run preview     # productiebuild lokaal bekijken op http://localhost:4173/
```

**Browser-smoketest (Playwright)** — draait tegen de *productiebuild*, op een desktop- en een smartphone-viewport:

```bash
npm run build
npx playwright install chromium   # eenmalig
npm run test:e2e
```

De tests controleren onder meer:

- **Schaal:** een contour van 60 × 40 eenheden in een viewBox van 100 × 100 wordt 60 × 40 mm (Basis) en 120 × 48 mm bij een kader van 200 × 120 mm (Expert); pixel-viewBoxen, mm-afmetingen, transformaties, `<use>` en clip-paths.
- **SVG-invoer:** vierkant, rechthoek, cirkel, hart, vijfpuntige ster, concave vorm, open contour, meerdere losse vormen, rasterafbeelding, tekst, scripts, `foreignObject`, event-handlers, externe verwijzingen, XML-entiteiten, kringverwijzingen en te complexe bestanden.
- **Mesh:** geen NaN/oneindige coördinaten, geen gedegenereerde driehoeken, elke rand bij precies twee driehoeken, consistente oriëntatie, positief volume, één samenhangend object, Z-minimum 0 en Z-maximum = hoogte, open binnenruimte, wanddikte binnen 0,015 mm, exact volume (vulvorm), en drukrand exact +2 mm.
- **STL:** binary-formaat, juiste lengte, normalen, en dat de mesh na het samenvoegen van vertices op float32-positie (zoals een slicer doet) nog altijd gesloten en manifold is.
- **Functioneel:** tabs, Basis/Expert, de vier velden, uploaden van geldige en ongeldige bestanden, genereren, downloaden (met juiste bestandsnaam), opnieuw beginnen, help-venster, en (Playwright) geen horizontale scroll op smartphone en geen consolefouten.

---

## Publiceren op GitHub Pages

De workflow staat in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Bij elke push naar `main` (of handmatig via *Run workflow*) doet hij:

1. repository uitchecken;
2. Node.js 22 instellen;
3. `npm ci`;
4. TypeScript-controle en tests;
5. productiebuild met `BASE_PATH=/<repositorynaam>/`;
6. de map `dist` publiceren naar GitHub Pages.

**Eenmalig instellen:**

1. Maak een repository op GitHub, bijvoorbeeld `maak-shape-to-stl`, en push deze code naar de branch `main`:
   ```bash
   git init
   git add .
   git commit -m "MAAK! Shape to STL"
   git branch -M main
   git remote add origin https://github.com/<gebruikersnaam>/maak-shape-to-stl.git
   git push -u origin main
   ```
2. Ga op GitHub naar **Settings → Pages** en kies bij **Source** voor **GitHub Actions**.
3. Wacht tot de workflow *Deploy naar GitHub Pages* groen is (tab **Actions**).
4. De site staat op `https://<gebruikersnaam>.github.io/maak-shape-to-stl/`.

Er zijn geen server-side routes of serverconfiguratie nodig. Alle assetpaden zijn relatief aan de `base` (`import.meta.env.BASE_URL`), zodat de site onder elk repositorypad werkt. Zonder `BASE_PATH` bouwt Vite met een relatief pad (`./`), wat ook werkt voor andere statische hosting.

De productiebuild bevat een strikte Content-Security-Policy: er worden geen externe scripts, stijlen of verbindingen toegelaten.

---

## Hoe de SVG-schaal werkt

Het **volledige SVG-referentiekader** (de `viewBox`; anders `width`/`height`) is de maatstaf, **niet** de bounding box van de zichtbare vorm.

- **Basis:** het kader is 100 × 100 mm. Een vorm die 60 % van de breedte en 70 % van de hoogte van het Canva-frame beslaat, wordt ongeveer 60 × 70 mm. Lege ruimte in het frame telt dus mee. De vorm wordt nooit opgerekt tot 100 × 100 mm en de verhoudingen blijven behouden.
- **Expert:** het volledige kader krijgt de ingestelde **Lengte** (X) × **Breedte** (Y). Kies je verschillende waarden, dan wordt de vorm bewust niet-proportioneel geschaald (kader 200 × 120 mm → schaal ×2 in X en ×1,2 in Y).

Formule: `x_mm = (x_svg − viewBox.x) × lengte / viewBox.breedte` en `y_mm = (viewBox.hoogte − (y_svg − viewBox.y)) × breedte / viewBox.hoogte` (de Y-as wordt omgedraaid omdat SVG naar beneden telt).

Na het schalen wordt de vorm in het XY-vlak rond (0, 0) gecentreerd; de afmetingen veranderen daardoor niet. De onderkant ligt op Z = 0. De drukrand van de cookie cutter steekt 2 mm buiten de gemeten contour uit.

---

## Ondersteunde SVG's

**Elementen:** `path` (rechte lijnen, kwadratische en kubische Béziercurves, bogen), `rect` (ook met afgeronde hoeken), `circle`, `ellipse`, `polygon`, `polyline` (gevuld), groepen `g`, `use` (interne verwijzingen), `clipPath` (in gebruikerscoördinaten), CSS-klassen in `<style>`.

**Transformaties:** `translate`, `scale`, `rotate`, `skewX`, `skewY` en `matrix`, zowel op groepen als op individuele vormen.

**Vulregels:** `nonzero` en `evenodd`. Overlappende gevulde vormen worden samengevoegd tot één contour.

**Curves** worden adaptief omgezet naar polygonen: maximaal 0,25 mm per lijnstukje op de uiteindelijke afmeting (min. 4, max. 720 per curve). Bij een cirkel van 70 mm is de afwijking kleiner dan 0,01 mm.

**Veiligheid.** SVG-bestanden worden als niet-vertrouwde invoer behandeld:

- inlezen gebeurt enkel als XML via `DOMParser`; er wordt nooit SVG-code in de pagina geplaatst (geen `innerHTML`). De 2D-preview wordt opnieuw getekend uit de berekende coördinaten;
- `script`, `foreignObject`, `iframe`, `embed`, `object`, event-handlers (`onload`, `onclick`, …) en niet-SVG-inhoud worden geweigerd;
- externe verwijzingen (`href` naar een URL, `url(...)` naar buiten, `@import`) en XML-entiteiten worden geweigerd;
- limieten: 2 MB, 5000 elementen, 1 000 000 tekens path-data, 80 000 punten na discretisatie, 500 `<use>`-uitvouwingen, en geen kringverwijzingen.

---

## Hoe de geometrie gemaakt wordt

**Gedeelde engine** (`src/engine/`, volledig los van React):

1. `svgValidation.ts` — veiligheidscontrole, `<use>` uitvouwen, clip-paths herschrijven.
2. `svgParser.ts` — `SVGLoader` → gevulde vormen met hun echte curves.
3. `svgScaling.ts` — SVG-eenheden → millimeter volgens het referentiekader.
4. `contourProcessing.ts` — discretiseren, vulregels, clip-paths, union, achtergrond herkennen, vereenvoudigen, controleren op zelfdoorsnijding, centreren.
5. `polygonOffset.ts` — offsets via Clipper2 met afgeronde hoeken (overal exact dezelfde afstand).
6. `triangulation.ts` — triangulatie met controle op oppervlak, gedegenereerde driehoeken en T-verbindingen.
7. `meshGeneration.ts` — gesloten meshes uit verticale wanden en horizontale vlakken met gedeelde vertices.
8. `meshValidation.ts` — controle zoals een slicer: geslotenheid, manifold, oriëntatie, samenhang, volume.
9. `stlExporter.ts` — binary STL via `STLExporter`.

**Cookie cutter.** Buitenzijde = SVG-contour, binnenzijde = inward offset van 1,2 mm; de binnenwand is volledig verticaal en het midden is open. De drukrand wordt opgebouwd uit fijne concentrische outward offsets: elke offsetring krijgt een korte verticale wand, en twee opeenvolgende ringen worden verbonden door een smalle horizontale strook die als *polygoon met gat* getrianguleerd wordt. Zo worden ringen met verschillende aantallen punten nooit punt-voor-punt verbonden, en is de mesh gegarandeerd gesloten en vrij van zelfdoorsnijdingen (dat wordt ook in 2D gecontroleerd: elke ring moet strikt binnen de volgende liggen). De trapjes zijn maximaal 0,15 mm hoog en 0,1 mm breed, kleiner dan een normale printlaag, zodat de overgang na het slicen glad verloopt.

**Vulvorm.** Gesloten bodem (Z 0–2 mm), buitenwand volgt de contour tot de volledige hoogte, uitsparing begint op Z = 2 mm met een inward offset van de wanddikte, open bovenzijde.

Een model wordt pas getoond én is pas downloadbaar nadat de mesh-validatie geslaagd is. Als een inward offset geen binnenruimte meer oplevert, of als de drukrand niet betrouwbaar gemaakt kan worden, krijg je een foutmelding in plaats van een foutieve STL.

---

## Beperkingen van versie 1

- De SVG moet **één samenhangende, gesloten, gevulde vorm** opleveren. Meerdere losse vormen geven een foutmelding (overlappende vormen worden wel samengevoegd).
- **Openingen binnenin** de vorm (bijv. een donut) worden genegeerd: enkel de buitencontour wordt gebruikt. Je krijgt daar een melding over.
- Lijnen zonder vulling (strokes), tekst, rasterafbeeldingen, maskers, geneste `<svg>`-elementen, symbolen met eigen viewBox en clip-paths in `objectBoundingBox`-eenheden worden niet ondersteund en geven een foutmelding. Omlijningen op gevulde vormen worden genegeerd (melding).
- CSS die vormen verbergt via een `<style>`-klasse met `display: none` wordt niet herkend; `display="none"` als attribuut of inline stijl wel.
- Inkepingen die zo smal zijn dat de 2 mm-drukrand een volledig ingesloten holte zou vormen, geven een foutmelding. Smalle spleten die gewoon overbrugd worden, zijn toegestaan.
- Delen van de vorm die smaller zijn dan twee keer de wanddikte worden massief (de binnenwand trekt zich terug). Wordt de binnenruimte volledig nul, dan volgt een foutmelding.
- De berekening gebeurt op de hoofdthread. Voor gewone vormen duurt dat 5–300 ms; zeer gedetailleerde vormen kunnen de pagina kort laten haperen.
- De JavaScript-bundel is ongeveer 270 kB gzip, vooral door Three.js.

---

## Projectstructuur

```text
├── public/
│   ├── logo.svg               tijdelijke MAAK!-wordmark (vervangbaar)
│   ├── favicon.svg
│   └── examples/              square, circle, heart, star
├── src/
│   ├── components/            Header, GeneratorTabs, ModeToggle, SVGUploader,
│   │                          ParameterPanel, Preview3D, GenerateButton,
│   │                          DownloadButton, HelpDialog
│   ├── generators/            types.ts, shared.ts, cookieCutter.ts,
│   │                          fillingMold.ts, index.ts (register)
│   ├── engine/                types.ts, errors.ts, geometry2d.ts, svgValidation.ts,
│   │                          svgParser.ts, svgScaling.ts, contourProcessing.ts,
│   │                          polygonOffset.ts, triangulation.ts, meshGeneration.ts,
│   │                          meshValidation.ts, stlExporter.ts, pipeline.ts
│   ├── config/defaults.ts     alle standaardwaarden en limieten
│   ├── styles/                global.css, components.css
│   ├── App.tsx
│   └── main.tsx
├── tests/                     Vitest: schaal, validatie, generators, mesh, STL, UI
├── e2e/                       Playwright-smoketest
├── .github/workflows/deploy.yml
├── vite.config.ts, tsconfig.json, playwright.config.ts, index.html
```

---

## Een nieuwe generator toevoegen

1. Voeg het id toe aan `GeneratorType` in `src/engine/types.ts`, bijvoorbeeld `'stamp'`.
2. Voeg standaardwaarden en limieten toe in `src/config/defaults.ts` (en in `DEFAULT_PARAMETERS` / `PARAMETER_LIMITS`).
3. Maak `src/generators/stamp.ts` met een object dat `ShapeGenerator` implementeert:

   ```ts
   export const stampGenerator: ShapeGenerator = {
     id: 'stamp',
     label: 'Stempel',
     title: 'Stempel',
     description: '…',
     defaults: STAMP_DEFAULTS,
     limits: STAMP_LIMITS,
     generate: (contour, params) => toResult(() => buildStamp(contour, params)),
   };
   ```

   Bouw de mesh met `MeshBuilder` (`ringLevel`, `wall`, `cap`) en `offsetRing`; dan is ze automatisch gesloten en manifold zolang ringen strikt genest zijn.
4. Registreer de generator in `GENERATORS` in `src/generators/index.ts`. De tab, de titel, de parameters, de validatie, de preview en de export volgen automatisch.
5. Voeg een slug toe in `GENERATOR_SLUG` (`src/engine/stlExporter.ts`) voor de bestandsnaam, en schrijf tests met de helpers uit `tests/meshChecks.ts`.

---

## Standaardparameters wijzigen

Alles staat in [`src/config/defaults.ts`](src/config/defaults.ts):

- `COOKIE_CUTTER_DEFAULTS` / `FILLING_MOLD_DEFAULTS` — waarden in Basismodus en beginwaarden in Expertmodus;
- `COOKIE_CUTTER_INTERNAL` — breedte (`flareWidth`) en hoogte (`flareHeight`) van de drukrand, minimale snijwand, trapgrootte;
- `FILLING_MOLD_INTERNAL` — bodemdikte;
- `*_LIMITS` — minimum, maximum en stap van de vier Expertvelden;
- `SVG_LIMITS` en `GEOMETRY` — veiligheidslimieten en geometrische nauwkeurigheid.

---

## Het MAAK!-logo vervangen

Vervang `public/logo.svg` door het officiële logo met dezelfde bestandsnaam. De header toont het op 30 px hoogte (26 px op smartphone) en schaalt de breedte mee. Wil je een PNG gebruiken, pas dan `LOGO_SRC` aan in `src/components/Header.tsx`. Het favicon staat in `public/favicon.svg`.
