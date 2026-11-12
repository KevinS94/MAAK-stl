import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeshData } from '../src/engine/types';
import { LETTERS, SVG } from './fixtures';

vi.mock('../src/components/Preview3D', () => ({
  Preview3D: ({ mesh }: { mesh: MeshData }) => <div data-testid="preview3d" data-triangles={mesh.indices.length / 3} />,
}));

import App from '../src/App';

let downloads: string[] = [];

beforeEach(() => {
  downloads = [];
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => undefined }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function upload(name: string, content: string) {
  const input = screen.getByTestId('file-input') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File([content], name, { type: 'image/svg+xml' })] } });
  });
}

describe('App: open contouren als middellijn', () => {
  it('een open "S" toont rol en interpretatie; Vulvorm genereert met vormdikte 8 mm', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'Vulvorm' }));
    await upload('s.svg', LETTERS.openS);

    // Ook met één enkel pad is de selector zichtbaar, want de interpretatie is een keuze.
    expect(await screen.findByRole('img', { name: /Alle vormen en lijnen/ })).toBeInTheDocument();
    expect(screen.getByText(/Pad 1 · Open lijn/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Rol van Pad 1/ })).toHaveValue('outer');
    const interp = screen.getByRole('combobox', { name: /Interpretatie van Pad 1/ });
    expect(interp).toHaveValue('centerline');
    // Een open lijn kan geen gesloten vorm zijn.
    expect(screen.getByRole('option', { name: 'Gesloten vorm' })).toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/vormdikte 8 mm/)).toBeInTheDocument(); // Basismodus-samenvatting

    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText(/Model klaar · .* × 20 mm/, {}, { timeout: 20000 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Download STL/ }));
    expect(downloads).toEqual(['maak-vulvorm-s.stl']);
  });

  it('Expert: "Vormdikte" verschijnt enkel bij een middellijn-buitencontour en verandert de vorm', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('radio', { name: 'Expert' }));
    expect(screen.queryByLabelText('Vormdikte (mm)')).toBeNull();

    await upload('hart.svg', SVG.heart);
    expect(screen.queryByLabelText('Vormdikte (mm)')).toBeNull();

    await upload('s.svg', LETTERS.openS);
    const field = await screen.findByLabelText('Vormdikte (mm)');
    expect(field).toHaveValue(8);
    const sizeBefore = screen.getByText(/vorm ≈ /).textContent;
    await user.clear(field);
    await user.type(field, '12');
    expect(screen.getByText(/vorm ≈ /).textContent).not.toBe(sizeBefore);
    // Ongeldige vormdikte blokkeert Start.
    await user.clear(field);
    await user.type(field, '0');
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    await user.clear(field);
    await user.type(field, '10');
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText(/Model klaar/, {}, { timeout: 20000 })).toBeInTheDocument();
  });

  it('een gevulde kalligrafische "S" (Canva) kan wisselen tussen middellijn en gesloten vorm', async () => {
    const user = userEvent.setup();
    render(<App />);
    await upload('letter.svg', LETTERS.canvaCalligraphicS);
    const interp = await screen.findByRole('combobox', { name: /Interpretatie van .*Smalle band/ });
    expect(interp).toHaveValue('centerline');
    expect(screen.getByText(/rond de middellijn, met een vormdikte van 8 mm/)).toBeInTheDocument();
    await user.selectOptions(interp, 'shape');
    expect(screen.queryByText(/rond de middellijn/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText(/Model klaar/, {}, { timeout: 20000 })).toBeInTheDocument();
  });

  it('Stempel in Basismodus: een open "S" krijgt een vormdikte waarop het handvat past', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'Stempel' }));
    await upload('s.svg', LETTERS.openS);
    expect(await screen.findByText(/vormdikte 24 mm/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText(/Model klaar/, {}, { timeout: 20000 })).toBeInTheDocument();
  });
});
