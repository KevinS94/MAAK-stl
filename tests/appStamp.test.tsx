import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeshData } from '../src/engine/types';
import { SVG } from './fixtures';

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

    expect(await screen.findByRole('img', { name: /Alle vectorpaden/ })).toBeInTheDocument();
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

  it('Expert bij Cutter & Stempel toont twee gegroepeerde parametersecties', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole('tab', { name: /Cutter & Stempel/ }));
    await user.click(screen.getByRole('radio', { name: 'Expert' }));
    const legends = Array.from(container.querySelectorAll('.params-group__legend')).map((el) => el.textContent);
    expect(legends).toEqual(['Cookie cutter', 'Stempel']);
    expect(screen.getAllByRole('spinbutton')).toHaveLength(10);
  });
});
