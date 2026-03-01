'use client';
import { useEffect, useState } from 'react';

export default function Dashboard() {
  const [metrics, setMetrics] = useState<any>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  const fetchMetrics = () => {
    fetch(`${API_URL}/api/metrics`)
      .then(res => res.json())
      .then(data => setMetrics(data));
  };

  useEffect(() => fetchMetrics(), []);

  const handleSeed = async () => {
    await fetch(`${API_URL}/api/seed`, { method: 'POST' });
    fetchMetrics();
  };

  if (!metrics) return <div className="p-10 text-center font-bold text-xl">Loading AI Metrics...</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-8 text-black">
      <header className="mb-8 flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-800">Factory AI Productivity</h1>
        <button onClick={handleSeed} className="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700">
          Reset & Seed Data
        </button>
      </header>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-white p-6 rounded-lg shadow border-l-4 border-blue-500">
          <p className="text-sm text-gray-500">Avg Factory Utilization</p>
          <p className="text-3xl font-bold">{metrics.factory.utilization}%</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow border-l-4 border-green-500">
          <p className="text-sm text-gray-500">Total Shift Units</p>
          <p className="text-3xl font-bold">{metrics.factory.total_units}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Worker</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Active (min)</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Idle (min)</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Utilization</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Units / Hr</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {metrics.workers.map((worker: any) => (
              <tr key={worker.worker_id}>
                <td className="px-6 py-4 font-medium text-gray-900">{worker.name}</td>
                <td className="px-6 py-4">{Math.round(worker.active_time / 60)}</td>
                <td className="px-6 py-4">{Math.round(worker.idle_time / 60)}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded text-xs font-bold ${worker.utilization >= 70 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {worker.utilization}%
                  </span>
                </td>
                <td className="px-6 py-4 font-bold">{worker.units_per_hour}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}