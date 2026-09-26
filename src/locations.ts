import type { Parcel } from './types'
import { applyLearnedValue } from './learning'

export interface LocationIdentity {
  key: string
  label: string
}

function compact(value: string) {
  return value
    .replace(/\s+/g, '')
    .replace(/[【】\[\]（）()，,。；;：:·]/g, '')
    .replace(/黑龙江省?|哈尔滨市|香坊区|铁东街道/g, '')
}

function cleanLocationLabel(value: string) {
  return compact(value)
    .replace(/(?:菜鸟|中通|圆通|韵达|申通|顺丰|极兔|邮政|EMS|快递中心|快递|代收点|驿站|门店|店)+$/gi, '')
    .replace(/(\d{2,6})$/, '$1号')
}

/** 只用本机 OCR 文本生成地点指纹，不请求地图或地理编码服务。 */
export function getLocationIdentity(parcel: Pick<Parcel, 'pickupSite' | 'pickupAddress'>): LocationIdentity {
  const site = compact(applyLearnedValue('pickupSite', parcel.pickupSite))
  const address = compact(parcel.pickupAddress)
  const combined = `${site}${address}`

  if (/北四/.test(combined)) {
    return { key: 'landmark:东北农业大学北四', label: '东北农业大学北四取件点' }
  }

  const roadNumber = combined.match(/([\u4e00-\u9fff]{1,10}(?:路|街|巷|道))(\d{2,6})号?/)
  const namedNumber = combined.match(/(\d{3,6})(?:号|店|中通|圆通|韵达|申通|顺丰|极兔|$)/)
  if (namedNumber) {
    const roadLabel = roadNumber && roadNumber[2] === namedNumber[1] ? `${roadNumber[1]}${namedNumber[1]}号取件点` : `${namedNumber[1]}号取件点`
    return { key: `number:${namedNumber[1]}`, label: roadLabel }
  }

  if (roadNumber) {
    const road = roadNumber[1]
    return { key: `number:${roadNumber[2]}`, label: `${road}${roadNumber[2]}号取件点` }
  }

  const cleanedSite = cleanLocationLabel(site)
  if (cleanedSite) return { key: `name:${cleanedSite}`, label: `${cleanedSite}取件点` }

  const cleanedAddress = cleanLocationLabel(address)
  if (cleanedAddress) return { key: `address-text:${cleanedAddress}`, label: cleanedAddress }

  return { key: 'unknown', label: '站点待确认' }
}
