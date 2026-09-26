import type { Parcel } from './types'

export function filterParcels(parcels: Parcel[], query: string, platform: string, status: string) {
  const keyword = query.trim().toLowerCase()
  return parcels.filter((parcel) => {
    if (platform !== '全部平台' && parcel.platform !== platform) return false
    if (status !== '全部状态' && parcel.status !== status) return false
    if (!keyword) return true
    return [parcel.trackingNumber, parcel.note]
      .some((field) => field.toLowerCase().includes(keyword))
  })
}
