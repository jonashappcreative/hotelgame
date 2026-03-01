import { render, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TurnTimer } from './TurnTimer';

describe('TurnTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts down from the given duration', () => {
    const onExpire = vi.fn();
    const { getByText } = render(
      <TurnTimer durationSeconds={10} isActive={true} onExpire={onExpire} />
    );

    expect(getByText('10s')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(3000); });

    expect(getByText('7s')).toBeTruthy();
  });

  it('calls onExpire exactly once when the countdown reaches zero', () => {
    const onExpire = vi.fn();
    render(<TurnTimer durationSeconds={3} isActive={true} onExpire={onExpire} />);

    act(() => { vi.advanceTimersByTime(5000); });

    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('does not start when isActive is false', () => {
    const onExpire = vi.fn();
    const { container } = render(
      <TurnTimer durationSeconds={5} isActive={false} onExpire={onExpire} />
    );

    act(() => { vi.advanceTimersByTime(10000); });

    expect(onExpire).not.toHaveBeenCalled();
    expect(container.firstChild).toBeNull();
  });

  it('resets when the component re-renders with a new durationSeconds value', () => {
    const onExpire = vi.fn();
    const { rerender, getByText } = render(
      <TurnTimer durationSeconds={10} isActive={true} onExpire={onExpire} />
    );

    act(() => { vi.advanceTimersByTime(5000); });
    expect(getByText('5s')).toBeTruthy();

    rerender(<TurnTimer durationSeconds={30} isActive={true} onExpire={onExpire} />);

    expect(getByText('30s')).toBeTruthy();
  });
});
