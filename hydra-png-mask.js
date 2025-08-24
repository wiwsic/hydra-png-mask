// hydra-png-mask.js — PNG Mask v4 with Aspect Ratio Support
// API: loadPngMask(url,name), useMask(name), maskShape(name,size,hardEdge,preserveAspect), maskShapeAspect(name,size,hardEdge,fitMode)

;(function () {
  const g = (typeof window !== 'undefined') ? window : globalThis

  function ensureHydra() {
    if (!(g.src && g.osc && g.shape)) {
      throw new Error('Hydra not detected. Initialize hydra-synth before using PNG masks.')
    }
    ;['s0','s1','s2','s3'].forEach(k=>{
      if (!g[k]) throw new Error(`Buffer ${k} missing. Ensure Hydra created s0..s3.`)
    })
  }

  const masks = new Map()
  g.masks = masks

  function clamp01(x){ return Math.max(0, Math.min(1, x)) }

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
    const th = 128 * (1 - hard)
    for (let i=0;i<data.length;i+=4){
      const L = data[i]
      const v = (L > th) ? 255 : 0
      data[i]=v; data[i+1]=v; data[i+2]=v
    }
    ctx.putImageData(imageData,0,0)
    return canvas
  }

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

  function processCanvasWithAspect(srcCanvas, size, hardEdge, preserveAspect, fitMode = 'contain'){
    const originalWidth = srcCanvas.width
    const originalHeight = srcCanvas.height
    const aspectRatio = originalWidth / originalHeight
    
    const workCanvas = document.createElement('canvas')
    const ctx = workCanvas.getContext('2d')
    const outputSize = Math.max(originalWidth, originalHeight, 1024)
    workCanvas.width = outputSize
    workCanvas.height = outputSize
    
    ctx.fillStyle = 'black'
    ctx.fillRect(0, 0, workCanvas.width, workCanvas.height)
    
    let drawWidth, drawHeight, x, y
    
    if (!preserveAspect) {
      if (size < 0.9) {
        const scaledWidth = outputSize * size
        const scaledHeight = outputSize * size
        x = (outputSize - scaledWidth) / 2
        y = (outputSize - scaledHeight) / 2
        ctx.drawImage(srcCanvas, x, y, scaledWidth, scaledHeight)
      } else {
        ctx.drawImage(srcCanvas, 0, 0, outputSize, outputSize)
      }
    } else {
      switch(fitMode) {
        case 'contain':
          if (aspectRatio > 1) {
            drawWidth = outputSize * size
            drawHeight = (outputSize * size) / aspectRatio
          } else {
            drawHeight = outputSize * size
            drawWidth = (outputSize * size) * aspectRatio
          }
          break
          
        case 'cover':
          if (aspectRatio > 1) {
            drawHeight = outputSize * size
            drawWidth = (outputSize * size) * aspectRatio
          } else {
            drawWidth = outputSize * size
            drawHeight = (outputSize * size) / aspectRatio
          }
          break
          
        case 'stretch':
          drawWidth = outputSize * size
          drawHeight = outputSize * size
          break
          
        default:
          if (aspectRatio > 1) {
            drawWidth = outputSize * size
            drawHeight = (outputSize * size) / aspectRatio
          } else {
            drawHeight = outputSize * size
            drawWidth = (outputSize * size) * aspectRatio
          }
      }
      
      x = (outputSize - drawWidth) / 2
      y = (outputSize - drawHeight) / 2
      
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(srcCanvas, x, y, drawWidth, drawHeight)
    }
    
    if (hardEdge > 0) {
      const imageData = ctx.getImageData(0, 0, workCanvas.width, workCanvas.height)
      const data = imageData.data
      const threshold = 128 * (1 - hardEdge)
      
      for (let i = 0; i < data.length; i += 4) {
        const luminance = data[i]
        const newValue = luminance > threshold ? 255 : 0
        
        data[i] = newValue
        data[i + 1] = newValue
        data[i + 2] = newValue
      }
      
      ctx.putImageData(imageData, 0, 0)
    }
    
    return workCanvas
  }

  function bufferRef(buf){
    if (typeof buf === 'number') return g[`s${buf}`]
    if (typeof buf === 'string') return g[buf]
    return g.s3
  }

  function renderToBuffer(canvas, buf){
    if (!buf || typeof buf.initImage !== 'function') {
      throw new Error('Invalid Hydra buffer for mask rendering (expected s0..s3).')
    }
    buf.initImage(canvas.toDataURL())
    return buf
  }

  async function loadPngMask(url, name){
    ensureHydra()
    if (!url || !name) throw new Error('loadPngMask(url, name) requires both parameters.')
    const img = await loadImageAny(url)
    const processed = alphaToGrayCanvas(img)
    masks.set(name, processed)
    console.log(`🎭 PNG mask loaded: ${name} (${processed.width}x${processed.height})`)
    return name
  }

  async function loadPngMasks(defs){
    const entries = Array.isArray(defs) ? defs : Object.entries(defs||{})
    const out = []
    for (const [name,url] of entries) out.push(loadPngMask(url, name))
    return Promise.all(out)
  }

  function useMask(name, opts={}){
    ensureHydra()
    const base = masks.get(name)
    if (!base) throw new Error(`Mask not found: ${name}`)
    const { buffer='s2' } = opts
    const buf = bufferRef(buffer)
    renderToBuffer(base, buf)
    return g.src(buf)
  }

  function maskShape(name, size=1, hardEdge=0, preserveAspect=false, opts={}){
    ensureHydra()
    const base = masks.get(name)
    if (!base) throw new Error(`Mask not found: ${name}`)
    const { buffer='s3' } = opts
    const buf = bufferRef(buffer)

    if (!preserveAspect && size < 0.9){
      const scaled = centerScaleCanvas(base, size)
      const th = thresholdCanvas(scaled, hardEdge)
      renderToBuffer(th, buf)
      return g.src(buf)
    } else if (!preserveAspect && size >= 0.9) {
      const tmp = thresholdCanvas(base, hardEdge)
      renderToBuffer(tmp, buf)
      return g.src(buf).scale(size)
    } else {
      const processed = processCanvasWithAspect(base, size, hardEdge, preserveAspect, 'contain')
      renderToBuffer(processed, buf)
      return g.src(buf)
    }
  }

  function maskShapeAspect(name, size=1, hardEdge=0, fitMode='contain', opts={}){
    ensureHydra()
    const base = masks.get(name)
    if (!base) throw new Error(`Mask not found: ${name}`)
    const { buffer='s3' } = opts
    const buf = bufferRef(buffer)

    const processed = processCanvasWithAspect(base, size, hardEdge, true, fitMode)
    renderToBuffer(processed, buf)
    return g.src(buf)
  }

  function listMasks(){ return Array.from(masks.keys()) }
  function reloadPngMask(name, url){ return loadPngMask(url, name) }

  g.loadPngMask     = loadPngMask
  g.loadPngMasks    = loadPngMasks
  g.useMask         = useMask
  g.maskShape       = maskShape
  g.maskShapeAspect = maskShapeAspect
  g.listMasks       = listMasks
  g.reloadPngMask   = reloadPngMask

  console.log('🎭 PNG Mask v4 with Aspect Ratio support loaded!')
})()
