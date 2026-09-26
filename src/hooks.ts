import { useCallback, useEffect, useState } from 'react'
import { listParcels } from './db'
import type { Parcel } from './types'

export function useParcels() {
  const [parcels, setParcels] = useState<Parcel[]>([])
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    setParcels(await listParcels())
    setLoading(false)
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  return { parcels, loading, refresh }
}
