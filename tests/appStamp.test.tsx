import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeshData } from '../src/engine/types';
import { canvaLeafSvg, SVG } from './fixtures';

vi.mock('../src/components/Preview3D', () => ({
  Preview3D: ({ mesh }: { mesh: MeshData }) => <div data-testid="preview3d" data-triangles={mesh.indices.length / 3} />,
}));

import App from '../src/App';

function svgFile(name: string, content: string): File {
  return new File([content], name, { type: 'image/svg+xml' });
}

let downloads: { name: string }[] = [];

beforeEach(() => {
  downloads = [];
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => undefined }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download });
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

describe('App: Stempel en Cutter & Stempel', () => {
  it('toont alle vier generators als tabs', () => {
    render(<App />);
    expect(screen.getByRole('tab', { name: 'Cookie cutter' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Vulvorm' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Stempel' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Cutter & Stempel' })).toBeInTheDocument();
  });

  it('een SVG met open nerven toont de padselector; de stempel genereert en downloadt', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'Stempel' }));
    await upload('blad.svg', SVG.leafWithVeins);

    expect(await screen.findByRole('img', { name: /Alle vormen en lijnen/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByTestId('preview3d', {}, { timeout: 10000 });
    expect(screen.getByText(/Model klaar/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Download STL/ }));
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('maak-stempel-blad.stl');
  });

  it('Cutter & Stempel toont twee downloadknoppen en een modelwissel', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: /Cutter & Stempel/ }));
    await upload('ster.svg', SVG.star);

    await user.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByTestId('preview3d', {}, { timeout: 10000 });

    expect(screen.getByRole('radio', { name: 'Cookie cutter' })).toBeInTheDocument();
    const stampView = screen.getByRole('radio', { name: 'Stempel' });
    await user.click(stampView);
    expect(stampView).toHaveAttribute('aria-checked', 'true');

    expect(screen.getAllByRole('button', { name: /Download STL/ })).toHaveLength(2);
    expect(screen.getByText('maak-cutter-stempel-cutter-ster.stl')).toBeInTheDocument();
    expect(screen.getByText('maak-cutter-stempel-stempel-ster.stl')).toBeInTheDocument();
  });

  it('twee losse vormen: selector i.p.v. fout; beide als buitencontour geeft pas dan een melding', async () => {
    const user = userEvent.setup();
    render(<App />);
    await upload('twee.svg', SVG.circleAndSquare);
    expect(await screen.findByRole('img', { name: /Alle vormen en lijnen/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/vorm ≈ 40 × 40 mm/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();

    const selects = screen.getAllByRole('combobox', { name: /Rol van/ });
    expect(selects).toHaveLength(2);
    for (const s of selects) await user.selectOptions(s, 'outer');
    expect(await screen.findByRole('alert')).toHaveTextContent(/2 losse delen/);
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();

    // De cirkel als enige buitencontour kiezen.
    await user.selectOptions(selects[1], 'ignore');
    expect(await screen.findByText(/vorm ≈ 30 × 30 mm/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
  });

  it('Canva-blad: rand als buitencontour, nerven als detail; Cutter & Stempel levert twee STL-bestanden', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole('tab', { name: /Cutter & Stempel/ }));
    await upload('blad.svg', canvaLeafSvg());

    expect(await screen.findByRole('img', { name: /Alle vormen en lijnen/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    const selects = screen.getAllByRole('combobox', { name: /Rol van/ });
    expect(selects.map((s) => (s as HTMLSelectElement).value)).toEqual(['outer', 'detail']);
    expect(screen.getByRole('combobox', { name: /Getekende rand/ })).toHaveValue('outer');
    expect(screen.getByText(/volledig opgevuld/)).toBeInTheDocument();
    expect(screen.getByText(/vorm ≈ 71 × 81 mm/)).toBeInTheDocument();

    // Aanklikken in de preview wisselt de rol van de hele logische vorm.
    const veins = container.querySelector('path[data-role="detail"]')!;
    await user.click(veins);
    expect(screen.getAllByRole('combobox', { name: /Rol van/ })[1]).toHaveValue('ignore');
    await user.selectOptions(screen.getAllByRole('combobox', { name: /Rol van/ })[1], 'detail');

    await user.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByTestId('preview3d', {}, { timeout: 20000 });
    await user.click(screen.getAllByRole('button', { name: /Download STL/ })[0]);
    await user.click(screen.getAllByRole('button', { name: /Download STL/ })[1]);
    expect(downloads.map((d) => d.name)).toEqual(['maak-cutter-stempel-cutter-blad.stl', 'maak-cutter-stempel-stempel-blad.stl']);
  });

  it('Canva-blad: afzonderlijke onderdelen tonen behoudt de keuze', async () => {
    const user = userEvent.setup();
    render(<App />);
    await upload('blad.svg', canvaLeafSvg());
    await user.click(await screen.findByRole('button', { name: 'Toon afzonderlijke onderdelen' }));
    const selects = screen.getAllByRole('combobox', { name: /Rol van/ });
    expect(selects.length).toBeGreaterThan(2);
    expect(selects.filter((s) => (s as HTMLSelectElement).value === 'detail')).toHaveLength(1);
    expect(screen.getByText(/vorm ≈ 71 × 81 mm/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Groepeer tot zichtbare vormen' }));
    expect(screen.getAllByRole('combobox', { name: /Rol van/ })).toHaveLength(2);
  });

  it('Expert: hoogte contour en hoogte details zijn apart instelbaar; contour 0 schakelt "dikte contour" uit', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'Stempel' }));
    await upload('blad.svg', SVG.leafWithVeins);
    await user.click(screen.getByRole('radio', { name: 'Expert' }));
    expect(screen.getByLabelText('Hoogte contour (mm)')).toHaveValue(1.5);
    expect(screen.getByLabelText('Hoogte details (mm)')).toHaveValue(1.5);
    expect(screen.getByLabelText('Dikte contour (mm)')).toBeEnabled();

    // Contour en details apart: totale hoogte = handvat 12 + plaat 3 + hoogste reliëf.
    await user.clear(screen.getByLabelText('Hoogte details (mm)'));
    await user.type(screen.getByLabelText('Hoogte details (mm)'), '2.5');
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText(/Model klaar · .* × 17,5 mm/, {}, { timeout: 20000 })).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Hoogte contour (mm)'));
    await user.type(screen.getByLabelText('Hoogte contour (mm)'), '0');
    expect(screen.getByLabelText('Dikte contour (mm)')).toBeDisabled();
    expect(screen.getByText(/Niet gebruikt: hoogte contour is 0 mm/)).toBeInTheDocument();
    // Een ongeldige waarde in het uitgeschakelde veld blokkeert niets.
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();

    await user.clear(screen.getByLabelText('Hoogte details (mm)'));
    await user.type(screen.getByLabelText('Hoogte details (mm)'), '1');
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText(/Model klaar · .* × 16 mm/, {}, { timeout: 20000 })).toBeInTheDocument();
  });

  it('Expert bij Cutter & Stempel toont twee gegroepeerde parametersecties', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole('tab', { name: /Cutter & Stempel/ }));
    await user.click(screen.getByRole('radio', { name: 'Expert' }));
    const legends = Array.from(container.querySelectorAll('.params-group__legend')).map((el) => el.textContent);
    expect(legends).toEqual(['Cookie cutter', 'Stempel']);
    expect(screen.getAllByRole('spinbutton')).toHaveLength(11);
  });
});
