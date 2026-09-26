import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { addParcel, clearParcels, getParcel, importParcels, listParcels, normalizeParcel, saveParcel } from './db'
import { filterParcels } from './filter'
import { cleanNumber, parseOcrText, simplifyProductName } from './ocr'
import { getLocationIdentity } from './locations'
import { calibrateTrackingNumber, getParcelColor, isReadyForPickup, normalizeTrackingNumber } from './parcel-utils'
import type { Parcel } from './types'

beforeEach(async () => { await clearParcels() })

describe('OCR 文本提取', () => {
  it('谨慎提取平台、公司和编号', () => {
    const result = parseOcrText('淘宝 物流详情\n顺丰速运\n运输中\n运单号：SF 1234 5678 901')
    expect(result.platform).toBe('淘宝')
    expect(result.carrier).toBe('顺丰')
    expect(result.trackingNumber).toBe('SF12345678901')
    expect(result.status).toBe('运输中')
  })
  it('没有明确平台或单号时不猜测', () => {
    const result = parseOcrText('您的包裹正在运输途中')
    expect(result.platform).toBe('待确认')
    expect(result.trackingNumber).toBe('')
  })
  it('识别常用购物平台', () => {
    expect(parseOcrText('唯品会\n订单物流').platform).toBe('唯品会')
    expect(parseOcrText('得物 App\n物流详情').platform).toBe('得物')
    expect(parseOcrText('POIZON\n包裹运输中').platform).toBe('得物')
    expect(parseOcrText('小红书\n订单详情').platform).toBe('小红书')
  })
  it('清理空格、冒号和标点', () => expect(cleanNumber('： YT 123, 456。')).toBe('YT123456'))
  it('允许 OCR 在字段标签字符间插入空格', () => {
    const result = parseOcrText('淘 宝 物流详情\n顺丰速运\n运 单 号：SF 1234 5678 901')
    expect(result.trackingNumber).toBe('SF12345678901')
  })

  it('把“某某快递：”后面的号码识别为快递单号', () => {
    expect(parseOcrText('韵达快递：321365524517052').trackingNumber).toBe('321365524517052')
    expect(parseOcrText('校园快递：YT 0709 4381 83921').trackingNumber).toBe('YT0709438183921')
  })

  it('中文公司名漏识别时仍用 SF 前缀确定顺丰及单号', () => {
    const result = parseOcrText('物流详情\nSF 1223 6486 32673 复制\n正在派送')
    expect(result.trackingNumber).toBe('SF1223648632673')
    expect(result.carrier).toBe('顺丰')
  })

  it('不把只有长号码和复制按钮的内容误当作快递单号', () => {
    expect(parseOcrText('订单编号 321365524517052 | 复制').trackingNumber).toBe('')
    expect(parseOcrText('& wpARE 321365624517052 | 复制 物流 电话').trackingNumber).toBe('')
  })

  it('只在截图出现明确状态文字时自动填写', () => {
    expect(parseOcrText('圆通速递\n已签收').status).toBe('已签收')
    expect(parseOcrText('圆通速递\n等待更新').status).toBe('待确认')
  })

  it('从两类物流截图文本提取取件码、站点、地址和商品名', () => {
    const taobao = parseOcrText('淘宝\n顺丰速运 SF1223648632673\n[代收点]您的顺丰包裹已由东北农业大学北四店代收\n取件码 92-24033\n天猫 诺沐旗舰店\n折叠榻榻米床垫直接铺地上定制')
    expect(taobao.pickupCode).toBe('92-24033')
    expect(taobao.pickupSite).toBe('东北农业大学北四店')
    expect(taobao.productName).toBe('榻榻米床垫')

    const pdd = parseOcrText('拼多多\n取件码：E2-5-23019\n中通快递 73727463027206\n收货地址：黑龙江哈尔滨市香坊区铁东街道东北农业大学北区驿站\n【哈尔滨市】快件已在代收点的【东北农业大学西北\n门长江路668号中通】暂放\n【取件地址：哈尔滨市香坊区农大北门长江路668】')
    expect(pdd.pickupCode).toBe('E2-5-23019')
    expect(pdd.pickupSite).toBe('东北农业大学西北门长江路668号中通')
    expect(pdd.pickupAddress).toContain('哈尔滨市香坊区农大北门长江路668')
  })

  it('把冗长商品标题压缩成容易辨认的名称', () => {
    expect(simplifyProductName('折叠榻榻米床垫直接铺地上定制')).toBe('榻榻米床垫')
    expect(simplifyProductName('酸辣柠檬鸡脚筋山椒鸡爪筋脆骨鸡爪')).toBe('酸辣柠檬鸡脚/鸡爪')
    expect(parseOcrText('滇潮农科食品专营店\n酸辣柠檬鸡脚筋山椒鸡爪筋脆骨鸡爪').productName).toBe('酸辣柠檬鸡脚/鸡爪')
  })
})

describe('包裹管理', () => {
  it('读取旧记录时把带乱码和价格的商品名简化', () => {
    const now = new Date().toISOString()
    const old: Parcel = { id: 'old', platform: '淘宝', carrier: '顺丰', trackingNumber: 'SF1', pickupSite: '', pickupAddress: '', pickupCode: '', productName: 'Las | 折午棉栅米床垫直接铺地上定，*#232.9', note: '', status: '待确认', archived: false, createdAt: now, updatedAt: now }
    expect(normalizeParcel(old).productName).toBe('床垫')
  })

  it('添加、编辑、搜索与筛选', async () => {
    const fields = { pickupSite: '', pickupAddress: '', pickupCode: '', productName: '' }
    const first = await addParcel({ ...fields, platform: '淘宝', carrier: '中通', trackingNumber: 'ZT10001', note: '蓝色外套', status: '运输中', archived: false })
    await addParcel({ ...fields, platform: '京东', carrier: '京东物流', trackingNumber: 'JD20002', note: '数据线', status: '已签收', archived: false })
    const edited = await saveParcel({ ...(await getParcel(first.id))!, note: '蓝色风衣' })
    expect(edited.note).toBe('蓝色风衣')
    const all = await listParcels()
    expect(filterParcels(all, '风衣', '全部平台', '全部状态')).toHaveLength(1)
    expect(filterParcels(all, '', '京东', '已签收')).toHaveLength(1)
  })

  it('导出结构可再次导入', async () => {
    const sample: Parcel = { id: 'sample-1', platform: '拼多多', customPlatform: '', carrier: '极兔', trackingNumber: 'JT30003', pickupSite: 'A站点', pickupAddress: 'A站点一层', pickupCode: 'A1-23', pickupReady: false, productName: '纸巾', note: '', status: '待确认', archived: false, images: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    await importParcels(JSON.parse(JSON.stringify({ parcels: [sample] })).parcels)
    expect(await listParcels()).toEqual([sample])
  })
})

describe('收货地点归并', () => {
  it('把同一校园地标的不同叫法归为一个地点', () => {
    const northFourStation = getLocationIdentity({ pickupSite: '东北农业大学北四驿站', pickupAddress: '' })
    const northFourShop = getLocationIdentity({ pickupSite: '东北农业大学北四店', pickupAddress: '' })
    expect(northFourStation.key).toBe(northFourShop.key)
  })

  it('把相同门牌号的快递公司店和门店归为一个地点', () => {
    const zto = getLocationIdentity({ pickupSite: '东北农业大学西北门长江路668号中通', pickupAddress: '' })
    const shop = getLocationIdentity({ pickupSite: '668店', pickupAddress: '' })
    expect(zto.key).toBe(shop.key)
  })
})

describe('同一快递阶段关联', () => {
  it('忽略单号空格和短横线并保持相同标记色', () => {
    expect(normalizeTrackingNumber('SF 123-456')).toBe(normalizeTrackingNumber('sf123456'))
    expect(getParcelColor('SF 123-456')).toBe(getParcelColor('sf123456'))
  })

  it('有驿站或取件码时进入取件管理，否则等待补充', () => {
    expect(isReadyForPickup({ pickupCode: '', pickupSite: '', status: '运输中' })).toBe(false)
    expect(isReadyForPickup({ pickupCode: '92-24033', pickupSite: '', status: '待确认' })).toBe(true)
    expect(isReadyForPickup({ pickupCode: '', pickupSite: '', pickupReady: true, status: '待确认' })).toBe(true)
  })

  it('用详情页新截图识别出的单号校准原单号', () => {
    expect(calibrateTrackingNumber('SF122364863267B', ['SF1223648632673'])).toBe('SF1223648632673')
    expect(calibrateTrackingNumber('465710470587280', [])).toBe('465710470587280')
  })
})
