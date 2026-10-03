'use strict'

// Mesajdaki ekler: satır içi resimler, indirme ve çözme, dosya kartları ve resim görüntüleyici.

// Mesajdaki ekler: satır içi resimler ve dosya kartları (5.6, Ek A1)

function buildAttachments (files, m) {
  const wrap = h('div', 'msg-attachments')
  files.forEach((f) => {
    wrap.appendChild(f.kind === 'image' ? buildImageBox(f, m) : buildFileCard(f))
  })
  return wrap
}

function fitBox (w, h0) {
  if (!w || !h0) return { w: 240, h: 180 }
  const scale = Math.min(1, IMAGE_BOX_MAX / w, IMAGE_BOX_MAX / h0)
  return { w: Math.max(48, Math.round(w * scale)), h: Math.max(48, Math.round(h0 * scale)) }
}

// Kutu genişliği w/h ile ayrılır, yükseklik dolgu oranıyla korunur (dar ekranda da oran bozulmaz).
function sizeImageBox (box, w, h0) {
  const size = fitBox(w, h0)
  box.style.width = size.w + 'px'
  const ratio = box.querySelector('.msg-image-ratio')
  if (ratio) ratio.style.paddingTop = ((size.h / size.w) * 100).toFixed(3) + '%'
}

function setImageOverlay (box, iconName, text) {
  const old = box.querySelector('.msg-image-overlay')
  if (old) box.removeChild(old)
  if (!text) return
  const overlay = h('span', 'msg-image-overlay')
  if (iconName) overlay.appendChild(icon(iconName))
  overlay.appendChild(h('span', 'msg-image-status', text))
  box.appendChild(overlay)
}

function buildImageBox (f, m) {
  const box = h('button', 'msg-image is-loading')
  box.type = 'button'
  box.setAttribute('aria-label', t('image.open', { name: f.name }))
  box.appendChild(h('span', 'msg-image-ratio'))
  sizeImageBox(box, f.w, f.h)
  setImageOverlay(box, null, t('image.loading'))
  box.disabled = true
  box.addEventListener('click', () => {
    const entry = imageCache.get(f.u)
    if (entry) openViewer(f, entry, box)
  })
  queueImage(f, box, m)
  return box
}

// Resim indirme kuyruğu ve blob URL önbelleği (en fazla 100, LRU)

const imageCache = new Map()
const imageInflight = new Map()
const imageQueue = []
let imageActive = 0

function cacheGet (id) {
  const entry = imageCache.get(id)
  if (!entry) return null
  imageCache.delete(id)
  imageCache.set(id, entry)
  return entry
}

function cachePut (id, entry) {
  imageCache.set(id, entry)
  while (imageCache.size > IMAGE_CACHE_MAX) {
    const oldest = imageCache.keys().next().value
    const old = imageCache.get(oldest)
    imageCache.delete(oldest)
    if (old && old.url) {
      try {
        URL.revokeObjectURL(old.url)
      } catch (err) {
        // Zaten bırakılmış
      }
    }
  }
}

function queueImage (f, box, m) {
  const cached = cacheGet(f.u)
  if (cached) {
    showImage(f, box, cached)
    return
  }
  imageQueue.push({ f: f, box: box, m: m })
  // Kutu henüz DOM'a eklenmedi, kuyruk bir sonraki turda işlenir
  setTimeout(pumpImages, 0)
}

function pumpImages () {
  while (imageActive < IMAGE_PARALLEL && imageQueue.length) {
    const job = imageQueue.shift()
    if (!isConnected(job.box)) continue
    imageActive += 1
    fetchImage(job.f).then((result) => {
      imageActive -= 1
      applyImageResult(job, result)
      pumpImages()
    })
  }
}

function fetchImage (f) {
  const cached = cacheGet(f.u)
  if (cached) return Promise.resolve({ ok: true, entry: cached })
  if (imageInflight.has(f.u)) return imageInflight.get(f.u)
  const job = downloadPlain(f, null).then((res) => {
    imageInflight.delete(f.u)
    if (!res.ok) return res
    const sniffed = window.E2EE.sniffImage(res.bytes)
    if (!sniffed || IMAGE_TYPES.indexOf(sniffed) === -1 || sniffed !== f.m) return { ok: false, notImage: true }
    const blob = new Blob([res.bytes], { type: sniffed })
    const entry = { url: URL.createObjectURL(blob), blob: blob, mime: sniffed }
    cachePut(f.u, entry)
    return { ok: true, entry: entry }
  })
  imageInflight.set(f.u, job)
  return job
}

function applyImageResult (job, result) {
  if (!isConnected(job.box)) return
  if (result.ok) {
    showImage(job.f, job.box, result.entry)
  } else if (result.notImage) {
    const card = buildFileCard(job.f)
    if (job.box.parentNode) job.box.parentNode.replaceChild(card, job.box)
  } else {
    job.box.classList.remove('is-loading')
    job.box.classList.add('is-failed')
    setImageOverlay(job.box, 'i-alert', t('image.failed'))
    job.box.setAttribute('aria-label', t('image.failedLabel', { name: job.f.name }))
  }
}

function showImage (f, box, entry) {
  const stick = isNearBottom()
  const img = h('img', 'msg-image-img')
  img.alt = f.name
  img.addEventListener('load', () => {
    box.classList.remove('is-loading')
    setImageOverlay(box, null, '')
    if (!f.w || !f.h) sizeImageBox(box, img.naturalWidth, img.naturalHeight)
    if (stick) scrollToBottom()
  })
  img.addEventListener('error', () => {
    box.classList.remove('is-loading')
    box.classList.add('is-failed')
    if (img.parentNode) img.parentNode.removeChild(img)
    setImageOverlay(box, 'i-alert', t('image.failed'))
  })
  img.src = entry.url
  box.appendChild(img)
  box.disabled = false
}

// Şifreli dosyayı indirip çözer. Yanıt { ok, bytes } veya { ok: false, error }.
async function downloadPlain (f, onProgress) {
  const res = await api('GET', '/api/uploads/' + f.u, null, {
    responseType: 'arraybuffer',
    timeout: TRANSFER_TIMEOUT_MS,
    onProgress: onProgress
  })
  if (res.status !== 200 || !(res.data instanceof ArrayBuffer)) {
    return { ok: false, error: () => (res.status === 404 ? t('file.notFound') : errorText(res, t('file.downloadFailed'))) }
  }
  let plain = null
  try {
    plain = window.E2EE.decryptFile(new Uint8Array(res.data), f.k, f.n)
  } catch (err) {
    plain = null
  }
  if (!plain) return { ok: false, error: () => t('file.decryptFailed') }
  return { ok: true, bytes: plain }
}

// Güvenli kaydetme: blob türü her zaman application/octet-stream, yeni sekme yok.
function saveBytes (data, name) {
  const blob = new Blob([data], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = h('a', 'download-helper')
  a.href = url
  a.download = name || t('files.defaultName')
  a.rel = 'noopener'
  document.body.appendChild(a)
  try {
    a.click()
  } finally {
    document.body.removeChild(a)
  }
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url)
    } catch (err) {
      // Zaten bırakılmış
    }
  }, REVOKE_DELAY_MS)
}

// Dosya kartı (Ek A1 madde 2..4)

function buildFileCard (f) {
  const card = h('button', 'file-card')
  card.type = 'button'
  const exec = isExecutable(f.name)
  const sizeText = formatSize(f.s)
  card.setAttribute('aria-label', t(exec ? 'file.cardLabelExec' : 'file.cardLabel', { name: f.name, size: sizeText }))
  card.appendChild(icon(FILE_ICONS[fileKind(f.name)] || 'i-file', 'file-card-icon'))
  const info = h('span', 'file-card-info')
  info.appendChild(h('span', 'file-card-name', f.name))
  const meta = h('span', 'file-card-meta', sizeText)
  info.appendChild(meta)
  if (exec) {
    const warn = h('span', 'file-card-warn')
    warn.appendChild(icon('i-alert'))
    warn.appendChild(h('span', '', t('file.execBadge')))
    info.appendChild(warn)
  }
  card.appendChild(info)
  const action = h('span', 'file-card-action')
  action.appendChild(icon('i-download'))
  const label = h('span', 'file-card-label', t('common.download'))
  action.appendChild(label)
  card.appendChild(action)
  card.addEventListener('click', () => {
    downloadFileCard(f, card, label)
  })
  return card
}

async function downloadFileCard (f, card, label) {
  if (card.getAttribute('aria-busy') === 'true') return
  if (isExecutable(f.name) && !window.confirm(t('file.execConfirm'))) return
  card.setAttribute('aria-busy', 'true')
  card.classList.add('is-busy')
  label.textContent = formatPercent(0)
  const res = await downloadPlain(f, (e) => {
    if (e && e.lengthComputable && e.total > 0) label.textContent = formatPercent(Math.min(100, Math.round((e.loaded / e.total) * 100)))
  })
  card.removeAttribute('aria-busy')
  card.classList.remove('is-busy')
  label.textContent = t('common.download')
  if (!res.ok) {
    toast(res.error, 'error')
    return
  }
  saveBytes(res.bytes, f.name)
}

// Tam ekran resim görüntüleyici

let viewerFile = null

function openViewer (f, entry, trigger) {
  viewerFile = { f: f, entry: entry }
  el.viewerName.textContent = f.name
  el.viewerImg.alt = f.name
  el.viewerImg.src = entry.url
  el.viewer.hidden = false
  openLayer({
    name: 'viewer',
    el: el.viewer,
    trigger: trigger,
    level: 3,
    trap: true,
    initialFocus: () => el.viewerClose,
    onClose: () => {
      el.viewer.hidden = true
      el.viewerImg.removeAttribute('src')
      viewerFile = null
    }
  })
}

function downloadFromViewer () {
  if (!viewerFile) return
  const f = viewerFile.f
  const ext = IMAGE_EXT[viewerFile.entry.mime] || 'bin'
  saveBytes(viewerFile.entry.blob, t('files.imageName', { id: f.u.slice(0, 8) }) + '.' + ext)
}
