import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EndTurnConfirmModal } from './EndTurnConfirmModal';

const renderModal = (props: Partial<React.ComponentProps<typeof EndTurnConfirmModal>> = {}) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <EndTurnConfirmModal
      purchasedThisTurn={0}
      pendingShares={0}
      pendingCost={0}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />
  );
  return { onConfirm, onCancel };
};

describe('EndTurnConfirmModal', () => {
  it('warns that nothing was bought when the player has bought nothing', () => {
    renderModal({ purchasedThisTurn: 0 });

    expect(screen.getByText("You haven't bought any stock")).toBeInTheDocument();
  });

  it('warns that stock is still available when the player bought some', () => {
    renderModal({ purchasedThisTurn: 2 });

    expect(screen.getByText('You can still buy stock')).toBeInTheDocument();
    expect(screen.getByText(/bought 2 of 3 shares/)).toBeInTheDocument();
  });

  it('does not mention a selection when nothing is pending', () => {
    renderModal({ pendingShares: 0 });

    expect(screen.queryByText(/never confirmed/)).not.toBeInTheDocument();
  });

  it('calls out shares that were selected but never confirmed', () => {
    renderModal({ pendingShares: 2, pendingCost: 1400 });

    expect(screen.getByText(/never confirmed/)).toBeInTheDocument();
    expect(screen.getByText('2 shares')).toBeInTheDocument();
    expect(screen.getByText('$1,400')).toBeInTheDocument();
  });

  it('uses the singular for a single pending share', () => {
    renderModal({ pendingShares: 1, pendingCost: 700 });

    expect(screen.getByText('1 share')).toBeInTheDocument();
  });

  it('ends the turn when the player confirms', () => {
    const { onConfirm, onCancel } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: /end turn anyway/i }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('returns to the buy panel when the player goes back', () => {
    const { onConfirm, onCancel } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: /review purchases/i }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
