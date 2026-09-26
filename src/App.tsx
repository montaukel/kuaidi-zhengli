import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Archive, Box, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Clipboard, Download, FileImage, Home, KeyRound, MapPin, Maximize2, PackageCheck, PackageOpen, Plus, Search, Settings, Trash2, Upload, X } from 'lucide-react'
import { Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { addParcel, clearParcels, getParcel, importParcels, isParcel, listParcels, removeParcel, saveParcel } from './db'
import { filterParcels } from './filter'
import { getOfficialPage } from './carriers'
import { recognizeImage } from './ocr'
import { useParcels } from './hooks'
import { CARRIERS, PLATFORMS, STATUSES, type Parcel, type ParcelDraft } from './types'
import { blobToDataUrl, dataUrlToBlob, optimizeImage } from './images'
import { getLocationIdentity } from './locations'
import { calibrateTrackingNumber, getParcelColor, isReadyForPickup, normalizeTrackingNumber } from './parcel-utils'
import { clearLearningRules, getLearningRuleCount, rememberCorrections } from './learning'

const emptyDraft: ParcelDraft = {
  platform: '待确认', customPlatform: '', carrier: '待确认', trackingNumber: '', pickupSite: '', pickupAddress: '', pickupCode: '', productName: '', note: '', status: '待确认', pickupReady: false, archived: false
}

const DEVELOPER_MESSAGE = 'halo，欢迎使用我独立制作的快递软件，有什么不满意的地方欢迎告诉我，该软件完全开源，完全免费无广告，旨在解决很多购物平台多个快递占点取件时不方便查看的问题，谢谢大家，中秋快乐。9.26'

function platformLabel(parcel: Pick<Parcel, 'platform' | 'customPlatform'>) {
  return parcel.platform === '其他' && parcel.customPlatform?.trim() ? parcel.customPlatform.trim() : parcel.platform
}

function App() {
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2600)
    return () => window.clearTimeout(timer)
  }, [notice])

  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/manage" element={<ManagementPage notify={setNotice} />} />
        <Route path="/add" element={<AddPage notify={setNotice} />} />
        <Route path="/parcel/:id" element={<DetailPage notify={setNotice} />} />
        <Route path="/settings" element={<SettingsPage notify={setNotice} />} />
      </Routes>
      {notice && <div className="toast" role="status"><Check size={18} />{notice}</div>}
      <BottomNav />
      <WebMcpTools />
    </div>
  )
}

function PageHeader({ title, back, action }: { title: string; back?: boolean; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="header-inner">
        {back ? <button className="icon-button" onClick={() => history.back()} aria-label="返回"><ChevronLeft /></button> : <div className="brand-mark"><Box /></div>}
        <h1>{title}</h1>
        <div className="header-action">{action}</div>
      </div>
    </header>
  )
}

function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="主导航">
      <NavLink to="/" end><Home /><span>物流跟踪</span></NavLink>
      <NavLink to="/manage"><PackageOpen /><span>取件管理</span></NavLink>
      <NavLink to="/settings"><Settings /><span>数据管理</span></NavLink>
    </nav>
  )
}

function ManagementPage({ notify }: { notify: (message: string) => void }) {
  const { parcels, loading, refresh } = useParcels()
  const [showPicked, setShowPicked] = useState(false)
  const [showAwaiting, setShowAwaiting] = useState(false)
  const active = parcels.filter((parcel) => !parcel.archived && isReadyForPickup(parcel))
  const awaiting = parcels.filter((parcel) => !parcel.archived && parcel.status !== '已签收' && !isReadyForPickup(parcel))
  const picked = parcels.filter((parcel) => !parcel.archived && parcel.status === '已签收')
  const groups = useMemo(() => {
    const grouped = new Map<string, { label: string; items: Parcel[] }>()
    active.forEach((parcel) => {
      const location = getLocationIdentity(parcel)
      const current = grouped.get(location.key)
      grouped.set(location.key, { label: current?.label ?? location.label, items: [...(current?.items ?? []), parcel] })
    })
    return [...grouped.values()].sort((a, b) => b.items.length - a.items.length)
  }, [active])

  async function completePickup(parcel: Parcel) {
    if (parcel.status === '已签收') return
    await saveParcel({ ...parcel, status: '已签收' })
    await refresh()
    notify('已标记为取件完成')
  }

  return (
    <>
      <PageHeader title="取件管理" action={<Link to="/add" className="icon-button add-header-button" aria-label="添加截图"><Plus /></Link>} />
      <main className="page management-page">
        <section className="manage-summary">
          <div><strong>{groups.length}</strong><span>个收货站点</span></div>
          <div><strong>{active.length}</strong><span>件待管理货物</span></div>
        </section>
        <p className="swipe-hint"><ChevronRight />在包裹卡片上向右滑，可快速标记取件完成</p>
        {!loading && awaiting.length > 0 && (
          <section className="awaiting-section">
            <button type="button" className="picked-toggle awaiting-toggle" onClick={() => setShowAwaiting((value) => !value)} aria-expanded={showAwaiting}>
              <span><Camera /><strong>待添加到站截图</strong><small>{awaiting.length} 件</small></span>
              <ChevronDown className={showAwaiting ? 'expanded' : ''} />
            </button>
            {showAwaiting && <div className="picked-list">{awaiting.map((parcel) => <ManagementCard key={parcel.id} parcel={parcel} onComplete={async () => {}} />)}</div>}
          </section>
        )}
        {loading ? <LoadingCards /> : groups.length ? groups.map(({ label, items }) => (
          <section className="station-group" key={label}>
            <header><div className="station-pin"><MapPin /></div><div><h2>{label}</h2><p>{items[0].pickupAddress || items[0].pickupSite || '详细地址待确认'}</p></div><strong>{items.length} 件</strong></header>
            <div className="manage-list">
              {items.map((parcel) => <ManagementCard key={parcel.id} parcel={parcel} onComplete={() => completePickup(parcel)} />)}
            </div>
          </section>
        )) : (
          <div className="empty-state"><div className="empty-icon"><PackageOpen /></div><h2>还没有待管理的快递</h2><p>上传物流截图后，会按识别出的收货站点自动归类。</p><Link className="primary-button" to="/add"><Plus />添加截图</Link></div>
        )}
        {!loading && picked.length > 0 && (
          <section className="picked-section">
            <button type="button" className="picked-toggle" onClick={() => setShowPicked((value) => !value)} aria-expanded={showPicked}>
              <span><PackageCheck /><strong>已取件</strong><small>{picked.length} 件</small></span>
              <ChevronDown className={showPicked ? 'expanded' : ''} />
            </button>
            {showPicked && <div className="picked-list">{picked.map((parcel) => <ManagementCard key={parcel.id} parcel={parcel} onComplete={async () => {}} />)}</div>}
          </section>
        )}
      </main>
    </>
  )
}

function ManagementCard({ parcel, onComplete }: { parcel: Parcel; onComplete: () => Promise<void> }) {
  const navigate = useNavigate()
  const parcelStyle = { '--parcel-color': getParcelColor(parcel.trackingNumber) } as CSSProperties
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [completing, setCompleting] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const offsetRef = useRef(0)
  const moved = useRef(false)
  const signed = parcel.status === '已签收'
  const threshold = 92
  const maxOffset = 126

  function updateOffset(value: number) {
    offsetRef.current = value
    setOffset(value)
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    moved.current = false
    if (signed || completing) return
    start.current = { x: event.clientX, y: event.clientY }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current || signed || completing) return
    const dx = event.clientX - start.current.x
    const dy = event.clientY - start.current.y
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
      start.current = null
      updateOffset(0)
      setDragging(false)
      return
    }
    if (dx <= 0) return
    if (dx > 8) moved.current = true
    updateOffset(Math.min(maxOffset, dx))
  }

  async function finishSwipe() {
    if (!start.current) return
    start.current = null
    setDragging(false)
    if (offsetRef.current < threshold) {
      updateOffset(0)
      return
    }
    updateOffset(maxOffset)
    setCompleting(true)
    try {
      await onComplete()
    } finally {
      updateOffset(0)
      setCompleting(false)
    }
  }

  return (
    <div className={`swipe-card ${signed ? 'swipe-card-complete' : ''}`} style={parcelStyle}>
      <div className={`swipe-complete-action ${offset >= threshold ? 'ready' : ''}`} aria-hidden="true">
        <PackageCheck />
        <span>{offset >= threshold ? '松开完成' : '右滑取件'}</span>
      </div>
      <div
        role="link"
        tabIndex={0}
        className="manage-card"
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => { void finishSwipe() }}
        onPointerCancel={() => { start.current = null; updateOffset(0); setDragging(false) }}
        onClick={() => { if (!moved.current) navigate(`/parcel/${parcel.id}`) }}
        onKeyDown={(event) => { if (event.key === 'Enter') navigate(`/parcel/${parcel.id}`) }}
        data-dragging={dragging || undefined}
      >
        <BlobImage blob={parcel.image} alt={parcel.productName || '物流截图'} className="manage-thumb" />
        <div className="manage-card-copy">
          <div><h3>{parcel.productName || parcel.note || `${parcel.carrier}包裹`}</h3>{signed ? <span className="picked-badge"><Check />已取件</span> : <ChevronRight />}</div>
          <p>{parcel.carrier} · {parcel.trackingNumber || '单号待补充'}</p>
          <span className={`pickup-code ${parcel.pickupCode ? '' : 'pickup-code-empty'}`}><KeyRound />{parcel.pickupCode || '取件码待确认'}</span>
        </div>
      </div>
    </div>
  )
}

function HomePage() {
  const { parcels, loading } = useParcels()
  const [query, setQuery] = useState('')
  const [platform, setPlatform] = useState('全部平台')
  const [status, setStatus] = useState('全部状态')
  const [showArchived, setShowArchived] = useState(false)
  const visible = useMemo(() => filterParcels(parcels.filter((item) => item.archived === showArchived), query, platform, status), [parcels, query, platform, status, showArchived])
  const counts = Object.fromEntries(STATUSES.map((item) => [item, parcels.filter((parcel) => parcel.status === item && !parcel.archived).length]))
  const archivedCount = parcels.filter((parcel) => parcel.archived).length

  return (
    <>
      <PageHeader title="物流跟踪" action={<Link to="/add" className="icon-button add-header-button" aria-label="添加截图"><Plus /></Link>} />
      <main className="page home-page">
        <section className="stats" aria-label="包裹统计">
          {STATUSES.map((item) => <div key={item} className={`stat stat-${item}`}><strong>{counts[item]}</strong><span>{item}</span></div>)}
        </section>

        <div className="search-box"><Search size={19} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索快递单号或备注" aria-label="搜索包裹" />{query && <button onClick={() => setQuery('')} aria-label="清除搜索"><X size={18} /></button>}</div>
        <div className="filters">
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="按平台筛选">
            <option>全部平台</option>{PLATFORMS.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="按状态筛选">
            <option>全部状态</option>{STATUSES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>

        <div className="section-title"><h2>{showArchived ? '已归档' : '我的包裹'}</h2><div><button className="archive-filter" onClick={() => setShowArchived(!showArchived)}>{showArchived ? '返回当前' : `已归档 ${archivedCount}`}</button><span>{visible.length} 件</span></div></div>
        {loading ? <LoadingCards /> : visible.length > 0 ? (
          <section className="parcel-list">
            {visible.map((parcel) => <ParcelCard key={parcel.id} parcel={parcel} />)}
          </section>
        ) : <EmptyState hasFilters={Boolean(query || platform !== '全部平台' || status !== '全部状态')} />}
      </main>
    </>
  )
}

function ParcelCard({ parcel }: { parcel: Parcel }) {
  return (
    <Link to={`/parcel/${parcel.id}`} className="parcel-card" style={{ '--parcel-color': getParcelColor(parcel.trackingNumber) } as CSSProperties}>
      <div className="parcel-top">
        <span className="platform-badge">{platformLabel(parcel)}</span>
        <span className={`status-badge status-${parcel.status}`}>{parcel.status}</span>
      </div>
      <div className="parcel-main">
        <div className="parcel-icon"><PackageCheck /></div>
        <div>
          <h3>{parcel.productName || parcel.note || `${parcel.carrier}包裹`}</h3>
          <p>{parcel.carrier} · {parcel.trackingNumber || '未填写单号'}</p>
        </div>
        <ChevronRight className="chevron" />
      </div>
      <time>{formatTime(parcel.createdAt)}添加</time>
    </Link>
  )
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><FileImage /></div>
      <h2>{hasFilters ? '没有匹配的包裹' : '还没有包裹'}</h2>
      <p>{hasFilters ? '试试更换筛选条件或搜索词' : '选择物流截图，在手机本地识别后添加'}</p>
      {!hasFilters && <Link className="primary-button" to="/add"><Plus />添加第一张截图</Link>}
    </div>
  )
}

interface UploadCandidate {
  key: string
  fileIndexes: number[]
  draft: ParcelDraft
  originalDraft: ParcelDraft
}

function mergeDraftDetails(current: ParcelDraft, next: ParcelDraft): ParcelDraft {
  const hasPickupDetails = Boolean(current.pickupCode || current.pickupSite || next.pickupCode || next.pickupSite)
  return {
    ...current,
    platform: next.platform !== '待确认' ? next.platform : current.platform,
    customPlatform: next.platform === '其他' ? next.customPlatform || current.customPlatform : next.platform !== '待确认' ? '' : current.customPlatform,
    carrier: next.carrier !== '待确认' ? next.carrier : current.carrier,
    trackingNumber: next.trackingNumber || current.trackingNumber,
    pickupSite: next.pickupSite || current.pickupSite,
    pickupAddress: next.pickupAddress || current.pickupAddress,
    pickupCode: next.pickupCode || current.pickupCode,
    productName: current.productName || next.productName,
    note: current.note || next.note,
    status: hasPickupDetails ? '待确认' : next.status !== '待确认' ? next.status : current.status
  }
}

function AddPage({ notify }: { notify: (message: string) => void }) {
  const navigate = useNavigate()
  const [uploadPlatform, setUploadPlatform] = useState<ParcelDraft['platform']>('待确认')
  const [uploadCustomPlatform, setUploadCustomPlatform] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [candidates, setCandidates] = useState<UploadCandidate[]>([])
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [savingStage, setSavingStage] = useState('')
  const [largePreview, setLargePreview] = useState<{ src: string; label: string } | null>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => { previews.forEach((preview) => URL.revokeObjectURL(preview)) }, [previews])

  const selectFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? [])
    if (!selected.length) return
    previews.forEach((preview) => URL.revokeObjectURL(preview))
    setFiles(selected)
    setPreviews(selected.map((file) => URL.createObjectURL(file)))
    setCandidates([])
    setError('')
    setProgress(0)
    try {
      const grouped = new Map<string, UploadCandidate>()
      for (let index = 0; index < selected.length; index += 1) {
        const result = await recognizeImage(selected[index], (value) => setProgress(Math.round(((index * 100) + value) / selected.length)))
        const draft: ParcelDraft = {
          ...emptyDraft,
          platform: uploadPlatform !== '待确认' ? uploadPlatform : result.platform,
          customPlatform: uploadPlatform === '其他' ? uploadCustomPlatform.trim() : '',
          carrier: result.carrier,
          trackingNumber: result.trackingNumber,
          pickupSite: result.pickupSite,
          pickupAddress: result.pickupAddress,
          pickupCode: result.pickupCode,
          productName: result.productName,
          status: result.pickupCode || result.pickupSite ? '待确认' : result.status
        }
        const key = result.trackingNumber ? normalizeTrackingNumber(result.trackingNumber) : `unknown-${index}`
        const current = grouped.get(key)
        grouped.set(key, current
          ? { ...current, fileIndexes: [...current.fileIndexes, index], draft: mergeDraftDetails(current.draft, draft), originalDraft: mergeDraftDetails(current.originalDraft, draft) }
          : { key, fileIndexes: [index], draft, originalDraft: draft })
      }
      const nextCandidates = [...grouped.values()]
      setCandidates(nextCandidates)
      const missingCount = nextCandidates.filter((candidate) => !candidate.draft.trackingNumber).length
      if (missingCount) setError(`有 ${missingCount} 组图片没有识别到快递单号，请分别手动填写。`)
    } catch (reason) {
      console.error(reason)
      setError('本地识别失败，请换一张清晰截图或手动填写。')
    } finally {
      setProgress(null)
      event.target.value = ''
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (savingStage) return
    if (candidates.some((candidate) => !candidate.draft.trackingNumber.trim())) {
      setError('请为每个快递填写单号后再保存。')
      return
    }
    setError('')
    setSavingStage('正在处理截图…')
    try {
    const optimizedImages = await Promise.all(files.map(optimizeImage))
    const regrouped = new Map<string, UploadCandidate>()
    candidates.forEach((candidate) => {
      const key = normalizeTrackingNumber(candidate.draft.trackingNumber)
      const current = regrouped.get(key)
      regrouped.set(key, current
        ? { ...current, fileIndexes: [...current.fileIndexes, ...candidate.fileIndexes], draft: mergeDraftDetails(current.draft, candidate.draft), originalDraft: mergeDraftDetails(current.originalDraft, candidate.originalDraft) }
        : { ...candidate, key })
    })
    setSavingStage('正在读取已有快递…')
    let knownParcels = await listParcels()
    const savedParcels: Parcel[] = []
    for (const candidate of regrouped.values()) {
      setSavingStage(`正在保存第 ${savedParcels.length + 1} / ${regrouped.size} 个快递…`)
      const draft = candidate.draft
      const trackingNumber = draft.trackingNumber.trim().toUpperCase()
      const candidateImages = candidate.fileIndexes.map((index) => optimizedImages[index])
      const existing = knownParcels.find((parcel) => normalizeTrackingNumber(parcel.trackingNumber) === normalizeTrackingNumber(trackingNumber))
      const cleanedDraft = { ...draft, trackingNumber, pickupSite: draft.pickupSite.trim(), pickupAddress: draft.pickupAddress.trim(), pickupCode: draft.pickupCode.trim().toUpperCase(), productName: draft.productName.trim(), note: draft.note.trim() }
      let parcel: Parcel
      if (existing) {
        const oldImages = existing.images?.length ? existing.images : existing.image ? [existing.image] : []
        const merged = mergeDraftDetails(existing, cleanedDraft)
        parcel = await saveParcel({ ...existing, ...merged, image: existing.image ?? candidateImages[0], images: [...oldImages, ...candidateImages] })
      } else {
        parcel = await addParcel({ ...cleanedDraft, image: candidateImages[0], images: candidateImages })
      }
      rememberCorrections(candidate.originalDraft, cleanedDraft)
      knownParcels = [parcel, ...knownParcels.filter((item) => item.id !== parcel.id)]
      savedParcels.push(parcel)
    }
    previews.forEach((preview) => URL.revokeObjectURL(preview))
    setPreviews([])
    setFiles([])
    notify(`已按单号保存 ${savedParcels.length} 个快递、${files.length} 张截图`)
    navigate(savedParcels.length === 1 ? `/parcel/${savedParcels[0].id}` : '/manage', { replace: true })
    } catch (reason) {
      console.error('保存快递失败：', reason)
      const detail = reason instanceof Error ? reason.message : String(reason)
      setError(`保存失败：${detail}。截图和填写内容仍在本页，请重试；若持续失败，请告诉我这条错误。`)
    } finally {
      setSavingStage('')
    }
  }

  return (
    <>
      <PageHeader title="添加截图" back />
      <main className="page form-page">
        {!files.length ? (
          <section className="upload-panel">
            <div className="upload-platform-picker">
              <label><span>本批次购买平台</span><select value={uploadPlatform} onChange={(event) => setUploadPlatform(event.target.value as ParcelDraft['platform'])}>{PLATFORMS.map((platform) => <option key={platform}>{platform}</option>)}</select></label>
              {uploadPlatform === '其他' && <label><span>自定义平台名称</span><input value={uploadCustomPlatform} onChange={(event) => setUploadCustomPlatform(event.target.value)} placeholder="例如：闲鱼" /></label>}
              <small>选择后，本次上传识别出的所有快递都会默认使用该平台。</small>
            </div>
            <div className="upload-illustration"><FileImage /></div>
            <h2>选择物流页面截图</h2>
            <p>可一次选择同一包裹的多张截图来补充细节；图片只在当前设备中处理。</p>
            <div className="upload-actions">
              <button className="primary-button" onClick={() => galleryRef.current?.click()}><Upload />批量从相册选择</button>
              <button className="secondary-button" onClick={() => cameraRef.current?.click()}><Camera />拍照上传</button>
            </div>
          </section>
        ) : (
          progress !== null && <div className="image-preview-wrap batch-preview-wrap">
            <div className="batch-preview-grid">{previews.map((preview, index) => <img key={preview} src={preview} className="image-preview" alt={`待识别的物流截图 ${index + 1}`} />)}</div>
            {progress !== null && <div className="ocr-overlay"><div className="spinner" /><strong>正在本地识别图片，请稍候</strong><span>{progress}%</span><div className="progress-track"><i style={{ width: `${progress}%` }} /></div></div>}
          </div>
        )}

        {candidates.length > 0 && progress === null && (
          <form onSubmit={submit} className="edit-form">
            <div className="form-intro"><div><strong>识别为 {candidates.length} 个快递</strong><p>相同单号合并，不同单号分开保存。</p></div><button type="button" className="text-button" onClick={() => galleryRef.current?.click()}>重新选择</button></div>
            {error && <div className="alert">{error}</div>}
            <div className="candidate-list">{candidates.map((candidate, candidateIndex) => (
              <section className="candidate-card" key={candidate.key} style={{ '--parcel-color': getParcelColor(candidate.draft.trackingNumber || candidate.key) } as CSSProperties}>
                <header><div><i /><strong>快递 {candidateIndex + 1}</strong><span>{candidate.fileIndexes.length} 张截图</span></div></header>
                <div className="candidate-previews">{candidate.fileIndexes.map((fileIndex, imageIndex) => (
                  <button type="button" className="candidate-preview-button" key={fileIndex} onClick={() => setLargePreview({ src: previews[fileIndex], label: `快递 ${candidateIndex + 1} 的第 ${imageIndex + 1} 张截图` })} aria-label={`查看快递 ${candidateIndex + 1} 的第 ${imageIndex + 1} 张大图`}>
                    <img src={previews[fileIndex]} alt={`快递 ${candidateIndex + 1} 截图`} />
                    <span><Maximize2 />查看大图</span>
                  </button>
                ))}</div>
                <ParcelFields value={candidate.draft} onChange={(draft) => setCandidates((items) => items.map((item, index) => index === candidateIndex ? { ...item, draft } : item))} />
              </section>
            ))}</div>
            <button className="primary-button full-button" type="submit" disabled={Boolean(savingStage)}><Check />{savingStage || `确认保存 ${candidates.length} 个快递`}</button>
          </form>
        )}
        <input ref={galleryRef} hidden multiple type="file" accept="image/*" onChange={selectFiles} />
        <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={selectFiles} />
        {largePreview && <ImageLightbox src={largePreview.src} label={largePreview.label} onClose={() => setLargePreview(null)} />}
      </main>
    </>
  )
}

function ImageLightbox({ src, blob, label, onClose }: { src?: string; blob?: Blob; label: string; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      <div className="image-lightbox-inner" onClick={(event) => event.stopPropagation()}>
        <div><strong>{label}</strong><button type="button" onClick={onClose} aria-label="关闭大图"><X /></button></div>
        {src ? <img src={src} alt={label} /> : <BlobImage blob={blob} alt={label} className="lightbox-image" />}
      </div>
    </div>
  )
}

function ParcelFields<T extends ParcelDraft>({ value, onChange }: { value: T; onChange: (value: T) => void }) {
  const field = <K extends keyof T>(key: K, next: T[K]) => onChange({ ...value, [key]: next })
  return (
    <div className="fields">
      <label><span>购买平台</span><select value={value.platform} onChange={(e) => field('platform', e.target.value as T['platform'])}>{PLATFORMS.map((item) => <option key={item}>{item}</option>)}</select></label>
      {value.platform === '其他' && <label><span>自定义平台名称</span><input value={value.customPlatform ?? ''} onChange={(e) => field('customPlatform', e.target.value as T['customPlatform'])} placeholder="例如：闲鱼" /></label>}
      <label><span>快递公司</span><select value={value.carrier} onChange={(e) => field('carrier', e.target.value as T['carrier'])}>{CARRIERS.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>快递单号 <b>必填</b></span><input value={value.trackingNumber} autoCapitalize="characters" onChange={(e) => field('trackingNumber', e.target.value.toUpperCase() as T['trackingNumber'])} placeholder="未识别到时请手动输入" /></label>
      <label><span>收货站点</span><input value={value.pickupSite} onChange={(e) => field('pickupSite', e.target.value as T['pickupSite'])} placeholder="例如：东北农业大学北四店" /></label>
      <label><span>收货地址</span><input value={value.pickupAddress} onChange={(e) => field('pickupAddress', e.target.value as T['pickupAddress'])} placeholder="识别不到时可手动填写" /></label>
      <label><span>取件码</span><input value={value.pickupCode} autoCapitalize="characters" onChange={(e) => field('pickupCode', e.target.value.toUpperCase() as T['pickupCode'])} placeholder="例如：E2-5-23019" /></label>
      <label><span>商品名称</span><input value={value.productName} onChange={(e) => field('productName', e.target.value as T['productName'])} placeholder="识别不到时可手动填写" /></label>
      <label><span>备注</span><input value={value.note} onChange={(e) => field('note', e.target.value as T['note'])} placeholder="选填" /></label>
      <label><span>包裹状态</span><select value={value.status} onChange={(e) => field('status', e.target.value as T['status'])}>{STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label>
    </div>
  )
}

function DetailPage({ notify }: { notify: (message: string) => void }) {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [parcel, setParcel] = useState<Parcel | null>(null)
  const [missing, setMissing] = useState(false)
  const [refreshProgress, setRefreshProgress] = useState<number | null>(null)
  const [largePreview, setLargePreview] = useState<{ blob: Blob; label: string } | null>(null)
  const refreshInputRef = useRef<HTMLInputElement>(null)
  const originalParcelRef = useRef<Parcel | null>(null)

  useEffect(() => { void getParcel(id).then((value) => { if (value) { setParcel(value); originalParcelRef.current = value } else setMissing(true) }) }, [id])
  const copy = async (value: string, label: string) => {
    if (!value) return notify(`${label}尚未填写`)
    await navigator.clipboard.writeText(value)
    notify(`${label}已复制`)
  }
  const official = async () => {
    if (!parcel?.trackingNumber) return notify('请先填写快递单号')
    await navigator.clipboard.writeText(parcel.trackingNumber)
    const page = getOfficialPage(parcel.carrier)
    if (page) {
      window.open(page, '_blank', 'noopener,noreferrer')
      notify('单号已复制，请在官网粘贴查询')
    } else notify('暂未配置该快递官网，单号已复制')
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!parcel) return
    const saved = await saveParcel(parcel)
    if (originalParcelRef.current) rememberCorrections(originalParcelRef.current, saved)
    originalParcelRef.current = saved
    setParcel(saved)
    notify('修改已保存')
    navigate(-1)
  }
  const remove = async () => {
    if (!parcel || !window.confirm('确定删除这个包裹吗？删除后无法恢复。')) return
    await removeParcel(parcel.id)
    notify('包裹已删除')
    navigate('/', { replace: true })
  }
  const toggleArchive = async () => {
    if (!parcel) return
    const next = await saveParcel({ ...parcel, archived: !parcel.archived })
    setParcel(next)
    notify(next.archived ? '包裹已归档' : '已取消归档')
  }
  const uploadLatestScreenshots = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? [])
    if (!parcel || !selected.length) return
    setRefreshProgress(0)
    try {
      let recognizedDraft: ParcelDraft = { ...parcel }
      const recognizedNumbers: string[] = []
      for (let index = 0; index < selected.length; index += 1) {
        const result = await recognizeImage(selected[index], (value) => setRefreshProgress(Math.round(((index * 100) + value) / selected.length)))
        if (result.trackingNumber) recognizedNumbers.push(result.trackingNumber)
        recognizedDraft = mergeDraftDetails(recognizedDraft, {
          ...emptyDraft,
          platform: result.platform,
          carrier: result.carrier,
          trackingNumber: result.trackingNumber,
          pickupSite: result.pickupSite,
          pickupAddress: result.pickupAddress,
          pickupCode: result.pickupCode,
          productName: result.productName,
          status: result.status
        })
      }
      const trackingNumber = calibrateTrackingNumber(parcel.trackingNumber, recognizedNumbers)
      const optimizedImages = await Promise.all(selected.map(optimizeImage))
      const oldImages = parcel.images?.length ? parcel.images : parcel.image ? [parcel.image] : []
      const next = await saveParcel({
        ...parcel,
        ...recognizedDraft,
        trackingNumber,
        pickupReady: true,
        status: '待确认',
        archived: false,
        image: parcel.image ?? optimizedImages[0],
        images: [...oldImages, ...optimizedImages]
      })
      setParcel(next)
      originalParcelRef.current = next
      const calibrated = normalizeTrackingNumber(trackingNumber) !== normalizeTrackingNumber(parcel.trackingNumber)
      notify(`${selected.length} 张最新截图已合并${calibrated ? '，快递单号已校准' : ''}；包裹已设为待取件`)
    } catch (reason) {
      console.error(reason)
      notify('最新截图识别失败，请换一张清晰截图再试')
    } finally {
      setRefreshProgress(null)
      event.target.value = ''
    }
  }

  if (missing) return <><PageHeader title="包裹详情" back /><main className="page"><EmptyState hasFilters /></main></>
  if (!parcel) return <><PageHeader title="包裹详情" back /><main className="page"><LoadingCards /></main></>
  return (
    <>
      <PageHeader title="包裹详情" back action={<span className={`status-badge status-${parcel.status}`}>{parcel.status}</span>} />
      <main className="page detail-page">
        <section className="tracking-hero">
          <span>{parcel.carrier}</span>
          <strong>{parcel.trackingNumber || '未填写快递单号'}</strong>
          <div className="detail-actions">
            <button onClick={() => copy(parcel.trackingNumber, '快递单号')}><Clipboard />复制单号</button>
            <button className="official-button" onClick={official}>前往官方查询<ChevronRight /></button>
          </div>
        </section>
        {(parcel.images?.length || parcel.image) && <section className="stored-image-card" style={{ '--parcel-color': getParcelColor(parcel.trackingNumber) } as CSSProperties}><div><strong>阶段截图</strong><span>{parcel.images?.length || 1} 张 · 点击查看大图</span></div><div className="stored-image-grid">{(parcel.images?.length ? parcel.images : parcel.image ? [parcel.image] : []).map((image, index) => <button type="button" className="stored-image-button" key={index} onClick={() => setLargePreview({ blob: image, label: `阶段截图 ${index + 1}` })} aria-label={`查看阶段截图 ${index + 1} 大图`}><BlobImage blob={image} alt={`保存的物流截图 ${index + 1}`} className="stored-image" /><span><Maximize2 />查看大图</span></button>)}</div></section>}
        <section className="refresh-shot-card">
          <div><strong>包裹已经到站？</strong><p>上传新的物流截图，将自动校准单号并更新取件码；没有取件码也会进入待取件列表。</p></div>
          <button type="button" className="secondary-button" disabled={refreshProgress !== null} onClick={() => refreshInputRef.current?.click()}><Camera />{refreshProgress === null ? '上传最新截图' : `正在识别 ${refreshProgress}%`}</button>
          <input ref={refreshInputRef} hidden multiple type="file" accept="image/*" onChange={uploadLatestScreenshots} />
        </section>
        <form className="edit-form detail-form" onSubmit={save}>
          <ParcelFields value={parcel} onChange={setParcel} />
          <button className="primary-button full-button" type="submit"><Check />保存修改</button>
          <button type="button" className="secondary-button full-button" onClick={toggleArchive}><Archive />{parcel.archived ? '取消归档' : '归档包裹'}</button>
          <button type="button" className="danger-button full-button" onClick={remove}><Trash2 />删除包裹</button>
        </form>
        {largePreview && <ImageLightbox blob={largePreview.blob} label={largePreview.label} onClose={() => setLargePreview(null)} />}
      </main>
    </>
  )
}

function SettingsPage({ notify }: { notify: (message: string) => void }) {
  const [count, setCount] = useState(0)
  const [learningCount, setLearningCount] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const refresh = () => { void listParcels().then((items) => setCount(items.length)); setLearningCount(getLearningRuleCount()) }
  useEffect(refresh, [])

  const exportData = async () => {
    const parcels = await listParcels()
    const backupParcels = await Promise.all(parcels.map(async ({ image, images, ...parcel }) => {
      const sourceImages = images?.length ? images : image ? [image] : []
      return { ...parcel, imageDataUrls: await Promise.all(sourceImages.map(blobToDataUrl)) }
    }))
    const blob = new Blob([JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), parcels: backupParcels }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `快递整理备份-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    notify(`已导出 ${parcels.length} 条数据`)
  }
  const importData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const payload = JSON.parse(await file.text()) as { parcels?: Array<Record<string, unknown>> }
      if (!Array.isArray(payload.parcels)) throw new Error('invalid')
      const parcels = payload.parcels.map((row) => {
        const { imageDataUrl, imageDataUrls, ...value } = row
        const restoredImages = Array.isArray(imageDataUrls) ? imageDataUrls.filter((item): item is string => typeof item === 'string').map(dataUrlToBlob) : typeof imageDataUrl === 'string' ? [dataUrlToBlob(imageDataUrl)] : []
        const parcel = { pickupSite: '', pickupAddress: '', pickupCode: '', productName: '', ...value, image: restoredImages[0], images: restoredImages }
        if (!isParcel(parcel)) throw new Error('invalid')
        return parcel
      })
      await importParcels(parcels)
      refresh()
      notify(`已导入 ${parcels.length} 条数据`)
    } catch {
      notify('导入失败：文件格式不正确')
    } finally { event.target.value = '' }
  }
  const clear = async () => {
    if (!window.confirm('确定清空全部包裹数据吗？此操作无法恢复，请先导出备份。')) return
    await clearParcels()
    refresh()
    notify('全部数据已清空')
  }
  const clearLearning = () => {
    if (!window.confirm('确定清除本机纠错学习记录吗？包裹数据不会被删除。')) return
    clearLearningRules()
    setLearningCount(0)
    notify('本地纠错学习记录已清除')
  }
  return (
    <>
      <PageHeader title="数据管理" back />
      <main className="page settings-page">
        <section className="privacy-card"><div className="shield">✓</div><div><h2>数据只在此设备</h2><p>共 {count} 条包裹记录。没有账号、服务器或云端同步。</p></div></section>
        <section className="settings-group">
          <button onClick={exportData}><span className="setting-icon"><Download /></span><span><strong>导出 JSON</strong><small>保存全部包裹的本地备份</small></span><ChevronRight /></button>
          <button onClick={() => inputRef.current?.click()}><span className="setting-icon"><Upload /></span><span><strong>导入 JSON</strong><small>合并备份中的包裹数据</small></span><ChevronRight /></button>
          <input ref={inputRef} hidden type="file" accept="application/json,.json" onChange={importData} />
        </section>
        <section className="settings-group"><button onClick={clearLearning}><span className="setting-icon"><Trash2 /></span><span><strong>清除本地纠错学习</strong><small>已记住 {learningCount} 条修正；不会删除包裹</small></span><ChevronRight /></button></section>
        <section className="settings-group danger-group"><button onClick={clear}><span className="setting-icon"><Trash2 /></span><span><strong>清空全部数据</strong><small>永久删除此设备中的全部记录</small></span><ChevronRight /></button></section>
        <section className="about-card"><h2>隐私说明</h2><p>截图用于浏览器内文字识别，并压缩后保存在此设备的 IndexedDB，方便在包裹详情中查看。截图不会上传云端。</p><p>首次使用 OCR 时会联网下载免费识别模型。本应用不查询实时物流，不使用 API Key、爬虫或付费服务。</p></section>
        <section className="developer-message" aria-label="开发者留言"><div><i />开发者留言</div><p>{DEVELOPER_MESSAGE}</p><small>此留言为只读内容，使用者无法修改</small></section>
      </main>
    </>
  )
}

function WebMcpTools() {
  useEffect(() => {
    if (!document.modelContext?.registerTool) return
    const lifecycle = new AbortController()
    const register = async () => {
      await document.modelContext?.registerTool({
        name: 'list_parcels', title: '列出包裹', description: '读取当前设备保存的包裹，可用关键词筛选快递单号或备注。',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        async execute(input) { const query = typeof (input as { query?: unknown })?.query === 'string' ? (input as { query: string }).query : ''; return { parcels: filterParcels(await listParcels(), query, '全部平台', '全部状态').map(({ image, ...parcel }) => ({ ...parcel, hasImage: Boolean(image) })) } }
      }, { signal: lifecycle.signal })
      await document.modelContext?.registerTool({
        name: 'create_parcel', title: '添加包裹', description: '把已经确认过的信息保存为新包裹。快递单号不能为空。',
        inputSchema: { type: 'object', properties: { trackingNumber: { type: 'string' }, note: { type: 'string' } }, required: ['trackingNumber'], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        async execute(input) {
          const data = input as { trackingNumber?: unknown; note?: unknown }
          if (typeof data.trackingNumber !== 'string' || !data.trackingNumber.trim()) throw new Error('快递单号不能为空')
          const parcel = await addParcel({ ...emptyDraft, trackingNumber: data.trackingNumber.trim(), note: typeof data.note === 'string' ? data.note : '' })
          window.dispatchEvent(new HashChangeEvent('hashchange'))
          return { id: parcel.id, saved: true }
        }
      }, { signal: lifecycle.signal })
    }
    void register().catch((error) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) console.error(error)
    })
    return () => lifecycle.abort()
  }, [])
  return null
}

function BlobImage({ blob, alt, className }: { blob?: Blob; alt: string; className: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!blob) { setUrl(''); return }
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])
  return url ? <img src={url} alt={alt} className={className} /> : <div className={`${className} image-placeholder`}><FileImage /></div>
}

function LoadingCards() { return <div className="loading-cards"><i /><i /><i /></div> }
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }

export default App
