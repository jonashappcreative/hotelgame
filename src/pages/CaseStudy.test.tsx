import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import CaseStudy from './CaseStudy';

// The exhibits only need playSfx; keep Howler out of jsdom
vi.mock('@/contexts/AudioContext', () => ({
  useAudio: () => ({ playSfx: vi.fn() }),
}));

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/case-study']}>
      <CaseStudy />
    </MemoryRouter>
  );

describe('CaseStudy page', () => {
  it('renders the story headline and all three exhibits', () => {
    renderPage();
    expect(screen.getByText(/From a New Year/i)).toBeInTheDocument();
    expect(screen.getByText('Exhibit — your opening move')).toBeInTheDocument();
    expect(screen.getByText('Exhibit — the hostile takeover')).toBeInTheDocument();
    expect(screen.getByText('Exhibit — the stock phase')).toBeInTheDocument();
  });

  it('place & found exhibit: placing 2D opens the chain chooser and founding works', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Place tile 2D' }));
    await waitFor(() =>
      expect(screen.getByText(/choose the brand/i)).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /Tower budget/ }));
    expect(screen.getByText(/founder's bonus/i)).toBeInTheDocument();
    expect(screen.getByText(/Tower established/i)).toBeInTheDocument();
  });

  it('merger exhibit: placing 3G converts Tower tiles and shows payout banner', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Place tile 3G/ }));
    // banner (with payouts) appears ~1.1s after placement
    await waitFor(
      () => expect(screen.getByText(/Majority bonus \$3,000/)).toBeInTheDocument(),
      { timeout: 2500 }
    );
    expect(screen.getByText(/Minority bonus \$1,500/)).toBeInTheDocument();
    expect(screen.getByText(/the survivor grows to 8 tiles/i)).toBeInTheDocument();
  });

  it('stock exhibit: enforces the 3-share limit and updates cash on purchase', () => {
    renderPage();
    const plusTower = screen.getByRole('button', { name: 'Add one Tower share' });
    fireEvent.click(plusTower);
    fireEvent.click(plusTower);
    fireEvent.click(plusTower);
    // limit reached — all plus buttons disabled
    expect(plusTower).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add one American share' })).toBeDisabled();
    // 3 × $300 (Tower at 3 tiles, budget tier)
    expect(screen.getByText('Total: $900')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Buy shares/ }));
    expect(screen.getByText('$5,100')).toBeInTheDocument();
    expect(screen.getByText(/Tower × 3/)).toBeInTheDocument();
  });
});
