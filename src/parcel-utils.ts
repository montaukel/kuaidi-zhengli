import type { Parcel } from './types'

export function normalizeTrackingNumber(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function isReadyForPickup(parcel: Pick<Parcel, 'pickupCode' | 'pickupSite' | 'pickupReady' | 'status'>) {
  return parcel.status !== '已签收' && Boolean(parcel.pickupReady || parcel.pickupCode.trim() || parcel.pickupSite.trim())
}

export function calibrateTrackingNumber(current: string, recognized: string[]) {
  const candidates = [...new Map(recognized
    .map((value) => [normalizeTrackingNumber(value), value.trim().toUpperCase()] as const)
    .filter(([normalized]) => normalized.length >= 8)).values()]
  if (!candidates.length) return current
  const normalizedCurrent = normalizeTrackingNumber(current)
  const exact = candidates.find((value) => normalizeTrackingNumber(value) === normalizedCurrent)
  if (exact) return exact
  if (candidates.length === 1) return candidates[0]

  const similarity = (value: string) => {
    const candidate = normalizeTrackingNumber(value)
    let same = 0
    const length = Math.min(normalizedCurrent.length, candidate.length)
    for (let index = 0; index < length; index += 1) if (normalizedCurrent[index] === candidate[index]) same += 1
    const suffix = normalizedCurrent.slice(-8) === candidate.slice(-8) ? 20 : 0
    return same + suffix - Math.abs(normalizedCurrent.length - candidate.length)
  }
  return candidates.sort((left, right) => similarity(right) - similarity(left))[0]
}

const parcelColors = ['#3157d5', '#d76523', '#7c4fd3', '#15946c', '#d04472', '#1677b8']

export function getParcelColor(trackingNumber: string) {
  const value = normalizeTrackingNumber(trackingNumber)
  let hash = 0
  for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  return parcelColors[Math.abs(hash) % parcelColors.length]
}
