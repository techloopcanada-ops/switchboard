import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export function useResource<T>(path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++generation.current;
    setLoading(true); setError('');
    try { const result = await api<T>(path); if (id === generation.current) setData(result); }
    catch (error) { if (id === generation.current) setError(String(error)); }
    finally { if (id === generation.current) setLoading(false); }
  }, [path]);
  useEffect(() => { setData(undefined); void refresh(); return () => { generation.current++; }; }, [refresh]);
  return { data, error, loading, refresh };
}
export function LoadState({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  return <>{loading && <p role="status" className="muted">Loading…</p>}{error && <div role="alert" className="error">{error} <button onClick={retry}>Try again</button></div>}</>;
}
