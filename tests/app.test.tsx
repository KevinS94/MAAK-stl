import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeshData } from '../src/engine/types';
import { SVG } from './fixtures';

// jsdom heeft geen WebGL: de 3D-preview wordt vervangen door een eenvoudige stub
// die wel controleert dát er een mesh wordt doorgegeven.
vi.mock('../src/components/Preview3D', () => ({
  Preview3D: ({ mesh }: { mesh: MeshData }) => (
    <div data-testid="preview3d" data-triangles={mesh.indices.length / 3} />
  ),
}));

import App from '../src/App';

function svgFile(name: string, content: string): File {
  return new File([content], name, { type: 'image/svg+xml' });
}

let downloads: { name: string; size: number }[] = [];

beforeEach(() => {
  downloads = [];
  let lastBlob: Blob | null = null;
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: (b: Blob) => {
      lastBlob = b;
      return 'blob:test';
    },
    revokeObjectURL: () => undefined,
  }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, size: lastBlob?.size ?? 0 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function upload(name: string, content: string) {
  const input = screen.getByTestId('file-input') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [svgFile(name, content)] } });
  });
}

describe('App', () => {
  it('start met Cookie cutter in Basismodus, zonder invoervelden', () => {
    render(<App />);
    expect(screen.getByRole('tab', { name: /Cookie cutter/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Cookie cutter');
    expect(screen.getByRole('radio', { name: 'Basis' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Download STL/ })).toBeNull();
  });

  it('wisselt tussen generators en modi; Expert toont exact vier parameters', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: /Vulvorm/ }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Vulvorm');

    await user.click(screen.getByRole('radio', { name: 'Expert' }));
    const fields = screen.getAllByRole('spinbutton');
    expect(fields).toHaveLength(4);
    expect(screen.getByLabelText('Lengte (mm)')).toHaveValue(100);
    expect(screen.getByLabelText('Breedte (mm)')).toHaveValue(100);
    expect(screen.getByLabelText('Hoogte (mm)')).toHaveValue(20);
    expect(screen.getByLabelText('Wanddikte (mm)')).toHaveValue(2);

    await user.click(screen.getByRole('tab', { name: /Cookie cutter/ }));
    expect(screen.getByLabelText('Hoogte (mm)')).toHaveValue(15);
    expect(screen.getByLabelText('Wanddikte (mm)')).toHaveValue(1.2);

    // Expertwaarden blijven bewaard bij terugschakelen.
    await user.clear(screen.getByLabelText('Hoogte (mm)'));
    await user.type(screen.getByLabelText('Hoogte (mm)'), '25');
    await user.click(screen.getByRole('radio', { name: 'Basis' }));
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    await user.click(screen.getByRole('radio', { name: 'Expert' }));
    expect(screen.getByLabelText('Hoogte (mm)')).toHaveValue(25);
  });

  it('ongeldige expertwaarde blokkeert Start met een melding', async () => {
    const user = userEvent.setup();
    render(<App />);
    await upload('hart.svg', SVG.heart);
    await user.click(screen.getByRole('radio', { name: 'Expert' }));
    await user.clear(screen.getByLabelText('Wanddikte (mm)'));
    await user.type(screen.getByLabelText('Wanddikte (mm)'), '50');
    expect(screen.getByText(/Kies een waarde tussen 0.4 en 5 mm/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('upload, genereer en download een cookie cutter', async () => {
    const user = userEvent.setup();
    render(<App />);
    await upload('hart.svg', SVG.heart);
    expect(await screen.findByText(/SVG geldig/)).toBeInTheDocument();
    expect(screen.getByText(/vorm ≈ 76 × 68 mm/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start' }));
    const preview = await screen.findByTestId('preview3d', {}, { timeout: 10000 });
    expect(Number(preview.dataset.triangles)).toBeGreaterThan(1000);
    expect(screen.getByText(/Model klaar · 80,2 × 71,7 × 15 mm/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Download STL/ }));
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('maak-cookie-cutter-hart.stl');
    expect(downloads[0].size).toBe(84 + 50 * Number(preview.dataset.triangles));
  });

  it('download hoort bij het juiste model: na wisselen is er eerst opnieuw Start nodig', async () => {
    const user = userEvent.setup();
    render(<App />);
    await upload('ster.svg', SVG.star);
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByTestId('preview3d', {}, { timeout: 10000 });

    await user.click(screen.getByRole('tab', { name: /Vulvorm/ }));
    expect(screen.queryByRole('button', { name: /Download STL/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByText(/Model klaar · 79,9 × 76 × 20 mm/, {}, { timeout: 10000 });
    await user.click(screen.getByRole('button', { name: /Download STL/ }));
    expect(downloads[0].name).toBe('maak-vulvorm-ster.stl');
  });

  it('toont een begrijpelijke fout voor een ongeldige SVG en laat corrigeren toe', async () => {
    render(<App />);
    await upload('foto.svg', SVG.raster);
    expect(await screen.findByRole('alert')).toHaveTextContent(/rasterafbeelding/);
    expect(screen.getByText('foto.svg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();

    // Twee losse vormen zijn geen fout meer bij het importeren: de gebruiker kiest de buitencontour.
    await upload('twee.svg', SVG.multiple);
    expect(await screen.findByText(/SVG geldig/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();

    await upload('cirkel.svg', SVG.circle);
    expect(await screen.findByText(/SVG geldig/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
  });

  it('weigert bestanden die geen SVG zijn', async () => {
    render(<App />);
    await upload('foto.png', 'xxx');
    expect(await screen.findByRole('alert')).toHaveTextContent(/geen SVG/);
  });

  it('generatiefout (te smalle vorm) wordt getoond en exporteert niets', async () => {
    const user = userEvent.setup();
    render(<App />);
    await upload('klein.svg', SVG.tiny);
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('alert', {}, { timeout: 10000 })).toHaveTextContent(/te smal/);
    expect(screen.queryByRole('button', { name: /Download STL/ })).toBeNull();
  });

  it('opnieuw beginnen wist bestand en resultaat', async () => {
    const user = userEvent.setup();
    render(<App />);
    await upload('hart.svg', SVG.heart);
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByTestId('preview3d', {}, { timeout: 10000 });
    await user.click(screen.getByRole('button', { name: 'Opnieuw beginnen' }));
    expect(screen.getByText('Upload je SVG-bestand')).toBeInTheDocument();
    expect(screen.queryByTestId('preview3d')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('help-venster opent en sluit', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Help' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/voedsel/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
