import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Parcel, ParcelDraft } from './types'
import { simplifyProductName } from './ocr'

interface ParcelDB extends DBSchema {
  parcels: {
    key: string
    value: Parcel
    indexes: { 'by-created': string }
  }
}

const DB_NAME = 'kuaidi-zhengli'
// 不指定版本：直接打开用户现有的 v1/v2 数据库，避免旧页面连接导致升级请求永久阻塞。
async function withDb<T>(action: (db: IDBPDatabase<ParcelDB>) => Promise<T>): Promise<T> {
  // 每次操作打开并及时关闭连接，避免热更新/旧标签页升级后复用失效的连接。
  const db = await openDB<ParcelDB>(DB_NAME, undefined, {
    upgrade(upgradeDb) {
      if (!upgradeDb.objectStoreNames.contains('parcels')) {
        const store = upgradeDb.createObjectStore('parcels', { keyPath: 'id' })
        store.createIndex('by-created', 'createdAt')
      }
    }
  })
  try {
    return await action(db)
  } finally {
    db.close()
  }
}

export async function listParcels() {
  // 旧版数据库不一定有 by-created 索引，读取时不依赖它。
  const values = await withDb((db) => db.getAll('parcels'))
  return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(normalizeParcel)
}

export async function getParcel(id: string) {
  const value = await withDb((db) => db.get('parcels', id))
  return value ? normalizeParcel(value) : undefined
}

export async function addParcel(draft: ParcelDraft) {
  const now = new Date().toISOString()
  const parcel: Parcel = { ...draft, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
  await withDb((db) => db.put('parcels', parcel))
  return parcel
}

export async function saveParcel(parcel: Parcel) {
  const value = { ...parcel, updatedAt: new Date().toISOString() }
  await withDb((db) => db.put('parcels', value))
  return value
}

export async function removeParcel(id: string) {
  await withDb((db) => db.delete('parcels', id))
}

export async function clearParcels() {
  await withDb((db) => db.clear('parcels'))
}

export async function importParcels(values: Parcel[]) {
  await withDb(async (db) => {
    const tx = db.transaction('parcels', 'readwrite')
    await Promise.all(values.map((value) => tx.store.put(value)))
    await tx.done
  })
}

export function isParcel(value: unknown): value is Parcel {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  const baseValid = ['id', 'platform', 'carrier', 'trackingNumber', 'note', 'status', 'createdAt', 'updatedAt']
    .every((key) => typeof row[key] === 'string') && typeof row.archived === 'boolean'
  const optionalStringsValid = ['pickupSite', 'pickupAddress', 'pickupCode', 'productName', 'customPlatform']
    .every((key) => row[key] === undefined || typeof row[key] === 'string')
  const pickupReadyValid = row.pickupReady === undefined || typeof row.pickupReady === 'boolean'
  const imagesValid = row.images === undefined || (Array.isArray(row.images) && row.images.every((image) => image instanceof Blob))
  return baseValid && optionalStringsValid && pickupReadyValid && (row.image === undefined || row.image instanceof Blob) && imagesValid
}

export function normalizeParcel(value: Parcel): Parcel {
  return {
    ...value,
    platform: String(value.platform) === '抖音商城' ? '抖音' : value.platform,
    customPlatform: value.customPlatform ?? '',
    pickupSite: value.pickupSite ?? '',
    pickupAddress: value.pickupAddress ?? '',
    pickupCode: value.pickupCode ?? '',
    pickupReady: value.pickupReady ?? false,
    productName: simplifyProductName(value.productName ?? ''),
    images: value.images?.length ? value.images : value.image ? [value.image] : []
  }
}
