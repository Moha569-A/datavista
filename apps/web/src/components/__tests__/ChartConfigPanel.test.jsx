import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChartConfigPanel from '../ChartConfigPanel';

const COLUMNS = [
  { name: 'region', type: 'category', nullCount: 0, nullRatio: 0, distinctCount: 4 },
  { name: 'revenue', type: 'number', nullCount: 0, nullRatio: 0, distinctCount: 100 },
  { name: 'notes', type: 'text', nullCount: 0, nullRatio: 0, distinctCount: 300 },
];

const BASE = {
  datasetId: 'ds-1',
  chartType: 'bar',
  xField: 'region',
  yField: 'revenue',
  aggregation: 'sum',
  filters: [],
  title: 'Revenue by region',
};

function setup(config = BASE) {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  render(
    <ChartConfigPanel
      columns={COLUMNS}
      valueCounts={{}}
      config={config}
      onChange={onChange}
      onSubmit={onSubmit}
    />,
  );
  return { onChange, onSubmit };
}

describe('ChartConfigPanel', () => {
  it('lists every chart type', () => {
    setup();
    ['Bar', 'Pie', 'Line', 'Area', 'Scatter', 'Histogram'].forEach((label) => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  it('explains why a numeric aggregation is invalid for a text field', () => {
    setup({ ...BASE, yField: 'notes', aggregation: 'sum' });
    expect(screen.getByText(/cannot be applied/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate chart/i })).toBeDisabled();
  });

  it('asks for an x-axis field when it is missing', () => {
    setup({ ...BASE, xField: '' });
    expect(screen.getByText(/Choose an x-axis field/i)).toBeInTheDocument();
  });

  it('requires a numeric field for a histogram', () => {
    setup({ ...BASE, chartType: 'histogram', xField: null, yField: 'notes' });
    expect(screen.getByText(/histograms need a numeric field/i)).toBeInTheDocument();
  });

  it('enables generation when the combination is valid', () => {
    const { onSubmit } = setup();
    const button = screen.getByRole('button', { name: /Generate chart/i });
    expect(button).toBeEnabled();
    button.click();
    expect(onSubmit).toHaveBeenCalled();
  });

  it('emits configuration changes when the chart type changes', async () => {
    const { onChange } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Line' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ chartType: 'line' }));
  });
});
