// hydra-png-mask.js  —  PNG Mask v3 (isolado, sem MIDI)
// Mantém: loadPngMask(url,name), useMask(name), maskShape(name,size,hardEdge), window.masks

;(function () {
  const g = (typeof window !== 'undefined') ? window : globalThis

  // === Checagens de Hydra ===
  function ensureHydra() {
    if (!(g.src && g.osc && g.shape)) {
      throw new Error('Hydra não detectado. Inicialize hydra-synth antes de usar as máscaras.')
    }
    ;['s0','s1','s2','s3'].forEach(k=>{
      if (!g[k]) throw new Error(`Buffer ${k} ausente. Certifique-se de que Hydra criou s0..s3.`)
    })
  }

  // === Store global de máscaras (canvas processado) ===
  const masks = new Map()
  g.masks = masks  // compat: expõe globalmente

  // === Utils ===
  function clamp01(x){ return Math.max(0, Math.min(1, x)) }

  // Carrega Image com fallback via fetch->blob (evita problemas de CORS em alguns hosts)
  function loadImageAny(url){
    return new Promise((resolve,reject)=>{
      const tryDirect = () => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = ()=>resolve(img)
        img.onerror = tryFetch
        img.src = url
      }
      const tryFetch = async () => {
        try {
          const resp = await fetch(url, { mode:'cors' })
          if(!resp.ok) throw new Error(`HTTP ${resp.status}`)
          const blob = await resp.blob()
          const obj = URL.createObjectURL(blob)
          const img2 = new Image()
          img2.onload = ()=>{ URL.revokeObjectURL(obj); resolve(img2) }
          img2.onerror = (e)=>reject(e)
          img2.src = obj
        } catch (e) {
          reject(e)
        }
      }
      tryDirect()
    })
  }

  // Converte PNG: alpha -> grayscale (RGB), alpha final = 255
  function alphaToGrayCanvas(img){
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = img.width
    canvas.height = img.height
    ctx.drawImage(img, 0, 0)
    const imageData = ctx.getImageData(0,0,canvas.width,canvas.height)
    const data = imageData.data
    for (let i=0;i<data.length;i+=4){
      const a = data[i+3]
      data[i]=a; data[i+1]=a; data[i+2]=a; data[i+3]=255
    }
    ctx.putImageData(imageData,0,0)
    return canvas
  }

  // Aplica threshold binário em RGB (alpha permanece 255)
  function thresholdCanvas(srcCanvas, hardEdge){
    const hard = clamp01(hardEdge||0)
    if (hard <= 0) return srcCanvas
    const canvas = document.createElement('canvas')
    canvas.width = srcCanvas.width
    canvas.height = srcCanvas.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(srcCanvas,0,0)
    const imageData = ctx.getImageData(0,0,canvas.width,canvas.height)
    const data = imageData.data
    const th = 128 * (1 - hard) // quanto maior hard, menor o threshold
    for (let i=0;i<data.length;i+=4){
      const L = data[i]
      const v = (L > th) ? 255 : 0
      data[i]=v; data[i+1]=v; data[i+2]=v // alpha fica 255
    }
    ctx.putImageData(imageData,0,0)
    return canvas
  }

  // Centraliza e escala dentro de fundo preto p/ size<1 (evita cortar)
  function centerScaleCanvas(srcCanvas, size){
    if (size >= 0.99 && size <= 1.01) return srcCanvas
    const canvas = document.createElement('canvas')
    canvas.width = srcCanvas.width
    canvas.height = srcCanvas.height
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'black'
    ctx.fillRect(0,0,canvas.width,canvas.height)
    const w = srcCanvas.width * size
    const h = srcCanvas.height * size
    const x = (canvas.width - w) / 2
    const y = (canvas.height - h) / 2
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(srcCanvas, x, y, w, h)
    return canvas
  }

  function bufferRef(buf){
    if (typeof buf === 'number') return g[`s${buf}`]
    if (typeof buf === 'string') return g[buf]
    return g.s3
  }

  function renderToBuffer(canvas, buf){
    if (!buf || typeof buf.initImage !== 'function') {
      throw new Error('Buffer Hydra inválido ao aplicar máscara (esperado s0..s3).')
    }
    // usar dataURL garante portabilidade
    buf.initImage(canvas.toDataURL())
    return buf
  }

  // ============ API ============

  // Carrega UMA máscara e guarda processada (alpha->gray)
  async function loadPngMask(url, name){
    ensureHydra()
    if (!url || !name) throw new Error('loadPngMask(url, name) requer ambos os parâmetros.')
    const img = await loadImageAny(url)
    const processed = alphaToGrayCanvas(img)
    // opcionalmente manter invisível no DOM para debug:
    // processed.style.display='none'; document.body.appendChild(processed)
    masks.set(name, processed)
    console.log(`🎭 PNG mask carregada: ${name} (${processed.width}x${processed.height})`)
    return name
  }

  // Carrega várias (obj ou array de pares)
  async function loadPngMasks(defs){
    const entries = Array.isArray(defs) ? defs : Object.entries(defs||{})
    const out = []
    for (const [name,url] of entries) out.push(loadPngMask(url, name))
    return Promise.all(out)
  }

  // Devolve src(buffer) da máscara sem transform (compat com seu useMask)
  function useMask(name, opts={}){
    ensureHydra()
    const base = masks.get(name)
    if (!base) throw new Error(`Máscara não encontrada: ${name}`)
    const { buffer='s2' } = opts
    const buf = bufferRef(buffer)
    renderToBuffer(base, buf)
    return g.src(buf)
  }

  // Igual ao seu maskShape(name,size,hardEdge):
  // - size < ~0.9: re-render centralizado em fundo preto
  // - hardEdge > 0: threshold binário
  // - size >= 1: aplica no canvas base e retorna src(buf).scale(size)
  function maskShape(name, size=1, hardEdge=0, opts={}){
    ensureHydra()
    const base = masks.get(name)
    if (!base) throw new Error(`Máscara não encontrada: ${name}`)
    const { buffer='s3' } = opts
    const buf = bufferRef(buffer)

    if (size < 0.9){
      const scaled = centerScaleCanvas(base, size)
      const th = thresholdCanvas(scaled, hardEdge)
      renderToBuffer(th, buf)
      return g.src(buf) // já centralizado
    } else {
      // Para >=1, mantém canvas base (com threshold), e usa .scale no Hydra
      const tmp = thresholdCanvas(base, hardEdge)
      renderToBuffer(tmp, buf)
      return g.src(buf).scale(size)
    }
  }

  // helpers extras
  function listMasks(){ return Array.from(masks.keys()) }
  function reloadPngMask(name, url){ return loadPngMask(url, name) } // mesmo nome = substitui

  // Expor API global preservando nomes originais
  g.loadPngMask  = loadPngMask
  g.loadPngMasks = loadPngMasks
  g.useMask      = useMask
  g.maskShape    = maskShape
  g.listMasks    = listMasks
  g.reloadPngMask= reloadPngMask

  console.log('🎭 PNG Mask v3 (isolado) carregado!')
})()
