import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RulesForm } from './RulesForm';
import { DEFAULT_RULES, type CustomRules } from '@/types/game';

const renderForm = (overrides: Partial<CustomRules> = {}) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <RulesForm
      mode="create"
      initialRules={{ ...DEFAULT_RULES, ...overrides }}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onCancel };
};

const openAdvanced = () => fireEvent.click(screen.getByRole('button', { name: /advanced rules/i }));

/** The value the form will submit, without depending on how it is rendered. */
const submitted = (onConfirm: ReturnType<typeof vi.fn>): CustomRules => {
  fireEvent.click(screen.getByRole('button', { name: /confirm rules/i }));
  return onConfirm.mock.calls[0][0];
};

describe('RulesForm — Basic', () => {
  it('shows exactly Board Size, Allow Selling and Chain Safety', () => {
    renderForm();

    expect(screen.getByText('Small board')).toBeInTheDocument();
    expect(screen.getByText('Allow selling')).toBeInTheDocument();
    expect(screen.getByText('Chain safety')).toBeInTheDocument();

    // Everything else is behind the disclosure.
    for (const label of [
      'Turn timer', 'Sell price', 'Cash visibility', 'Bonus tier',
      'Max chains', 'Starting cash', 'Starting tiles', 'Place starting tile',
    ]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('defaults chain safety to Aggressive, and says so', () => {
    renderForm();
    expect(screen.getByText(/Aggressive — no safe chains/)).toBeInTheDocument();
  });

  it('submits the rules unchanged when nothing is touched', () => {
    const { onConfirm } = renderForm();
    expect(submitted(onConfirm)).toEqual(DEFAULT_RULES);
  });

  it("writes 'off' ⇄ '75' from the Allow selling switch", () => {
    const { onConfirm } = renderForm();
    fireEvent.click(screen.getByLabelText('Allow selling'));
    expect(submitted(onConfirm).stockSelling).toBe('75');
  });

  it('turns the selling switch off again', () => {
    const { onConfirm } = renderForm({ stockSelling: '50' });
    fireEvent.click(screen.getByLabelText('Allow selling'));
    expect(submitted(onConfirm).stockSelling).toBe('off');
  });
});

describe('RulesForm — Advanced disclosure', () => {
  it('reveals the remaining rules when opened', () => {
    renderForm();
    openAdvanced();

    for (const label of [
      'Turn timer', 'Cash visibility', 'Bonus tier',
      'Max chains', 'Starting cash', 'Starting tiles', 'Place starting tile',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('shows Place starting tile as its own top-level switch', () => {
    renderForm();
    openAdvanced();
    // Not nested under a "starting conditions" toggle any more — it is directly
    // operable, which is what the v1 grouping prevented.
    expect(screen.getByLabelText('Place starting tile')).toBeInTheDocument();
  });

  it('hides Sell price while selling is off and shows it once on', () => {
    renderForm();
    openAdvanced();
    expect(screen.queryByText('Sell price')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Allow selling'));
    expect(screen.getByText('Sell price')).toBeInTheDocument();
  });

  it('hides the first-rounds exemption while the timer is off', () => {
    renderForm();
    openAdvanced();
    expect(screen.queryByLabelText(/Disable timer for the first 2 rounds/)).not.toBeInTheDocument();
  });

  it('shows the first-rounds exemption when the timer is on', () => {
    renderForm({ turnTimer: '60' });
    openAdvanced();
    expect(screen.getByLabelText(/Disable timer for the first 2 rounds/)).toBeInTheDocument();
  });
});

describe('RulesForm — board size coupling', () => {
  it('drops Max Chains to 5 when the small board is chosen', () => {
    const { onConfirm } = renderForm();
    fireEvent.click(screen.getByLabelText('Small board'));

    const rules = submitted(onConfirm);
    expect(rules.boardSize).toBe('small');
    expect(rules.maxChains).toBe('5');
  });

  it('explains the coupling in the Advanced section', () => {
    renderForm({ boardSize: 'small', maxChains: '5' });
    openAdvanced();
    expect(screen.getByText(/small board is best with 5 chains/i)).toBeInTheDocument();
  });

  it('leaves Max Chains alone on the large board', () => {
    const { onConfirm } = renderForm({ boardSize: 'small', maxChains: '5' });
    fireEvent.click(screen.getByLabelText('Small board'));

    const rules = submitted(onConfirm);
    expect(rules.boardSize).toBe('large');
    expect(rules.maxChains).toBe('5');
  });
});

describe('RulesForm — modes', () => {
  it('labels the commit button by what it does', () => {
    const { onCancel } = renderForm();
    expect(screen.getByRole('button', { name: /confirm rules/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('says Save Rules when editing an existing room', () => {
    render(
      <RulesForm mode="edit" initialRules={DEFAULT_RULES} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /save rules/i })).toBeInTheDocument();
    expect(screen.getByText(/apply immediately for everyone/i)).toBeInTheDocument();
  });
});
