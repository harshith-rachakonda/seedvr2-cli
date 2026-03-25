"use client"

import { useState, useEffect, useRef, useCallback } from "react"

const API = "http://127.0.0.1:8000"

type JobStatus = {
  job_id: string
  status: "queued" | "initializing" | "processing" | "encoding" | "completed" | "error"
  percent: number
  log: string
  url: string | null
  filename: string | null
  created_at: number
  resolution?: string
  model?: string
  original_filename?: string
}

const STATUS_LABELS: Record<string, string> = {
  queued: "⏳ Queued…",
  initializing: "🧹 Clearing GPU memory…",
  processing: "⚡ Running SeedVR2…",
  encoding: "🎬 Re-encoding for playback…",
  completed: "✅ Complete!",
  error: "❌ Failed",
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [resolution, setResolution] = useState("1080p")
  const [model, setModel] = useState("3b")
  const [availableModels, setAvailableModels] = useState<Record<string, string>>({ "3b": "seedvr2_ema_3b_fp8_e4m3fn.safetensors", "7b": "seedvr2_ema_7b_fp8_e4m3fn.safetensors" })

  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [history, setHistory] = useState<JobStatus[]>([])
  const [showLog, setShowLog] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const logRef = useRef<HTMLPreElement>(null)
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  // Fetch available models on mount
  useEffect(() => {
    fetch(`${API}/models`)
      .then(r => r.json())
      .then(d => {
        if (d.models && Object.keys(d.models).length > 0) {
          setAvailableModels(d.models)
        }
      })
      .catch(() => { })
  }, [])

  // Fetch job history on mount
  const fetchHistory = useCallback(() => {
    fetch(`${API}/jobs`)
      .then(r => r.json())
      .then(d => {
        if (d.jobs) {
          const done = d.jobs.filter((j: JobStatus) => j.status === "completed")
          setHistory(done)
        }
      })
      .catch(() => { })
  }, [])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [jobStatus?.log])

  // Poll status when we have a jobId
  useEffect(() => {
    if (!jobId) return
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/status/${jobId}`)
        if (!res.ok) return
        const data: JobStatus = await res.json()
        setJobStatus(data)
        if (data.status === "completed" || data.status === "error") {
          clearInterval(pollRef.current!)
          setLoading(false)
          fetchHistory()
        }
      } catch { }
    }, 800)
    return () => clearInterval(pollRef.current!)
  }, [jobId, fetchHistory])

  // Upload handler
  const uploadVideo = async () => {
    if (!file) {
      setErrorMsg("Please select or drop a video file.")
      return
    }
    setErrorMsg(null)
    setLoading(true)
    setJobId(null)
    setJobStatus(null)

    const formData = new FormData()
    formData.append("file", file)
    formData.append("resolution", resolution)
    formData.append("model", model)
    formData.append("chunk_size", "20")

    try {
      const res = await fetch(`${API}/upscale`, { method: "POST", body: formData })
      const data = await res.json()

      if (res.status === 429) {
        setErrorMsg("A job is already running. Please wait for it to finish.")
        setLoading(false)
        return
      }
      if (data.status === "error") {
        setErrorMsg(data.message)
        setLoading(false)
        return
      }
      // Job queued successfully
      setJobId(data.job_id)
    } catch (err) {
      setErrorMsg("Failed to connect to backend. Is it running?")
      setLoading(false)
    }
  }

  // Drag-and-drop
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) setFile(dropped)
  }

  const isProcessing = loading && jobStatus && jobStatus.status !== "completed" && jobStatus.status !== "error"
  const progressPct = jobStatus?.percent ?? 0

  return (
    <main className="app-bg min-h-screen text-white flex flex-col items-center px-4 py-12 font-sans">

      {/* ── Header ──────────────────────────────────── */}
      <header className="flex flex-col items-center mb-12 select-none">
        <h1 className="text-5xl font-extrabold tracking-tight gradient-text mb-2">
          PMF AI Upscaler
        </h1>
        <p className="text-gray-400 text-base tracking-wide">
          Cinematic 4K video upscaling
        </p>
      </header>

      {/* ── Upload Card ─────────────────────────────── */}
      <section className="glass-card w-full max-w-2xl mb-8">

        {/* Drop Zone */}
        <div
          className={`drop-zone ${isDragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
          onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="video/*"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
          <div className="flex flex-col items-center gap-2 pointer-events-none">
            <span className="text-4xl">{file ? "🎥" : "📂"}</span>
            {file
              ? <p className="text-sm text-green-400 font-medium">{file.name}</p>
              : <>
                <p className="text-gray-300 font-medium">Drag & drop a video here</p>
                <p className="text-xs text-gray-500">or click to browse · MP4, MKV, MOV…</p>
              </>
            }
          </div>
        </div>

        {/* Controls Row */}
        <div className="grid grid-cols-2 gap-4 mt-6">
          <div>
            <label className="block text-xs text-gray-400 mb-1 uppercase tracking-widest">Resolution</label>
            <select
              value={resolution}
              onChange={e => setResolution(e.target.value)}
              className="select-input"
              data-value={resolution}
            >
              <option value="720p" className="opt-720">🟡 720p HD</option>
              <option value="1080p" className="opt-1080">🟠 1080p Full HD</option>
              <option value="4k" className="opt-4k">🔴 4K Ultra HD</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1 uppercase tracking-widest">Model</label>
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              className="select-input"
              data-value={model}
            >
              <option value="3b" className="opt-3b">🟢 3B Model — Fast</option>
              <option value="7b" className="opt-7b">🔵 7B Model — Quality</option>
            </select>
          </div>
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="mt-4 p-3 rounded-lg bg-red-900/40 border border-red-500/30 text-red-300 text-sm">
            {errorMsg}
          </div>
        )}

        {/* Upscale Button */}
        <button
          onClick={uploadVideo}
          disabled={loading || !file}
          className="upscale-btn mt-6 w-full"
        >
          {loading
            ? <><span className="btn-spinner" /> Processing…</>
            : "⚡ Upscale Video"
          }
        </button>
      </section>

      {/* ── Progress Section ─────────────────────────── */}
      {jobStatus && (
        <section className="glass-card w-full max-w-2xl mb-8 animate-fadein">

          {/* Status label */}
          <div className="flex justify-between items-center mb-3">
            <span className={`text-sm font-medium ${jobStatus.status === "error" ? "text-red-400" : jobStatus.status === "completed" ? "text-green-400" : "text-orange-300"}`}>
              {STATUS_LABELS[jobStatus.status] ?? jobStatus.status}
            </span>
            <button
              className="text-xs text-gray-500 hover:text-gray-300 transition"
              onClick={() => setShowLog(v => !v)}
            >
              {showLog ? "Hide log" : "Show log"}
            </button>
          </div>

          {/* Progress bar */}
          <div className="progress-track">
            <div
              className={`progress-fill ${jobStatus.status === "error" ? "error" : ""}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 mt-1 text-right">{progressPct}%</p>

          {/* Log viewer */}
          {showLog && (
            <pre
              ref={logRef}
              className="log-box mt-4"
            >
              {jobStatus.log || "Waiting for output…"}
            </pre>
          )}

          {/* Output video */}
          {jobStatus.status === "completed" && jobStatus.url && (
            <div className="mt-6 animate-fadein">
              <h2 className="text-base font-semibold mb-3 text-gray-200">🎬 Output Preview</h2>
              <video
                src={jobStatus.url}
                controls
                autoPlay
                className="w-full rounded-xl ring-1 ring-white/10 shadow-xl"
              />
              <a
                href={jobStatus.url}
                download={jobStatus.filename ?? "upscaled.mp4"}
                className="download-btn mt-4 block w-full text-center"
              >
                ⬇ Download {jobStatus.filename}
              </a>
            </div>
          )}
        </section>
      )}

      {/* ── Job History ──────────────────────────────── */}
      {history.length > 0 && (
        <section className="glass-card w-full max-w-2xl">
          <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-widest">Recent Jobs</h2>
          <ul className="space-y-3">
            {history.map(job => (
              <li key={job.job_id} className="history-item">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200 truncate font-medium">
                    {job.original_filename ?? job.filename ?? "video"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {job.resolution} · {job.model?.toUpperCase()} · {new Date(job.created_at * 1000).toLocaleTimeString()}
                  </p>
                </div>
                {job.url && (
                  <a
                    href={job.url}
                    download={job.filename ?? "upscaled.mp4"}
                    className="history-dl-btn"
                  >
                    ⬇ Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

    </main>
  )
}