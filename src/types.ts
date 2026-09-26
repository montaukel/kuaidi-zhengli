export const PLATFORMS = ['待确认', '淘宝', '京东', '拼多多', '抖音', '小红书', '唯品会', '得物', '其他'] as const
export const CARRIERS = ['待确认', '韵达', '圆通', '中通', '申通', '顺丰', '极兔', '京东物流', '邮政 EMS', '其他'] as const
export const STATUSES = ['运输中', '待确认', '已签收'] as const

export type Platform = typeof PLATFORMS[number]
export type Carrier = typeof CARRIERS[number]
export type ParcelStatus = typeof STATUSES[number]

export interface Parcel {
  id: string
  platform: Platform
  customPlatform?: string
  carrier: Carrier
  trackingNumber: string
  pickupSite: string
  pickupAddress: string
  pickupCode: string
  productName: string
  note: string
  status: ParcelStatus
  pickupReady?: boolean
  archived: boolean
  image?: Blob
  images?: Blob[]
  createdAt: string
  updatedAt: string
}

export type ParcelDraft = Omit<Parcel, 'id' | 'createdAt' | 'updatedAt'>
