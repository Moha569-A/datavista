import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChartView from '../ChartView';

const DATA = [
  { label: 'East', value: 2531681 },
  { label: 'West', value: 2523119 },
  { label: 'South', value: 2316382 },
];

describe('ChartView', () => {
  it('renders a loading skeleton while data is in flight', () => {
    const { container } = render(<ChartView chartType="bar" data={[]} loading />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('explains an empty result instead of rendering a blank box', () => {
    render(<ChartView chartType="pie" data={[]} />);
    expect(screen.getByText(/No data to display/i)).toBeInTheDocument();
    expect(screen.getByText(/filters or aggregation may exclude/i)).toBeInTheDocument();
  });

  it('surfaces errors with a recovery action', () => {
    const onRetry = vi.fn();
    render(<ChartView chartType="bar" data={[]} error="Dataset is not ready." onRetry={onRetry} />);
    expect(screen.getByText('Dataset is not ready.')).toBeInTheDocument();
    screen.getByRole('button', { name: /try again/i }).click();
    expect(onRetry).toHaveBeenCalled();
  });

  it('renders a bar for every data point', () => {
    const { container } = render(<ChartView chartType="bar" data={DATA} height={300} />);
    expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBe(DATA.length);
  });

  it('provides a text summary for assistive technology', () => {
    render(<ChartView chartType="bar" data={DATA} height={300} />);
    const summary = document.querySelector('.sr-only');
    expect(summary.textContent).toMatch(/3 categories/);
    expect(summary.textContent).toMatch(/Largest category is East/);
  });

  it('renders a pie sector per category', () => {
    const { container } = render(<ChartView chartType="pie" data={DATA} height={300} />);
    expect(container.querySelectorAll('.recharts-pie-sector').length).toBe(DATA.length);
  });
});
