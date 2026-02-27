import { useState } from 'react';
import { CITY_TO_MODELS, type City } from '../cityModel';
import { sendCitySelection } from '../api/prediction';
import { toast } from 'react-toastify';

export default function CitySelect() {
  const [selectedCity, setSelectedCity] = useState<City | null>(null);
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Use city model names for selection
  const cityModels = [
    { label: 'Atlanta', value: 'ga' },
    { label: 'Los Angeles', value: 'ca' },
    { label: 'New York', value: 'ny' },
    { label: 'Seattle', value: 'wa' },
    { label: 'Chicago', value: 'il' },
    { label: 'Miami', value: 'fl' },
    { label: 'Dallas', value: 'tx' },
    { label: 'Denver', value: 'co' },
    { label: 'Boston', value: 'ma' },
    { label: 'San Francisco', value: 'sf' },
    { label: 'Washington DC', value: 'dc' },
    { label: 'Phoenix', value: 'az' },
    { label: 'Philadelphia', value: 'pa' },
    { label: 'Houston', value: 'tx' },
    { label: 'Minneapolis', value: 'mn' },
    { label: 'Detroit', value: 'mi' },
    { label: 'Portland', value: 'or' },
    { label: 'Las Vegas', value: 'nv' },
    { label: 'San Diego', value: 'ca' },
    { label: 'Orlando', value: 'fl' },
  ];

  const handleNext = async () => {
    if (!selectedCity) return;

    const models = CITY_TO_MODELS[selectedCity];
    const extraFeatures = {
      // add any inputs your backend needs:
      speed: 60,
      ambientTemp: 30
    };

    setLoading(true);
    setError(null);
    toast.info("Sending prediction request...");
    try {
      const data = await sendCitySelection(selectedCity, models, extraFeatures);
      setResp(data);
      toast.success("Prediction completed successfully!");
    } catch (e: any) {
      setError(e?.message || 'Request failed');
      toast.error(e?.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{maxWidth: 560, margin: '20px auto', fontFamily: 'system-ui, sans-serif'}}>
      <h2>Pick a City</h2>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12,
        marginBottom: 16
      }}>
        {cityModels.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => setSelectedCity(value as City)}
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              border: selectedCity === value ? '2px solid dodgerblue' : '1px solid #ddd',
              background: selectedCity === value ? '#f0f7ff' : 'white',
              cursor: 'pointer',
              textTransform: 'capitalize'
            }}
          >
            {label}
          </button>
        ))}
      </div>




      <button
        onClick={handleNext}
        disabled={!selectedCity || loading}
        style={{
          padding: '10px 16px',
          borderRadius: 8,
          border: 'none',
          background: (!selectedCity || loading) ? '#bbb' : '#1e90ff',
          color: 'white',
          cursor: (!selectedCity || loading) ? 'not-allowed' : 'pointer'
        }}
      >
        {loading ? 'Sending…' : 'Next'}
      </button>

      {error && <p style={{ color: 'crimson', marginTop: 12 }}>{error}</p>}
      {resp && (
        <pre style={{ marginTop: 12, background: '#f7f7f7', padding: 12, borderRadius: 8 }}>
          {JSON.stringify(resp, null, 2)}
        </pre>
      )}
    </div>
  );
}
