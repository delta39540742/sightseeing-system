import { useRef, useState, useCallback } from 'react'
import { Camera, Upload, X } from 'lucide-react'

interface CameraCaptureProps {
  onCapture: (file: File) => void
}

export function CameraCapture({ onCapture }: CameraCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    setPreview(url)
    onCapture(file)
  }, [onCapture])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const clearPreview = () => {
    setPreview(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  if (preview) {
    return (
      <div className="relative rounded-xl overflow-hidden bg-gray-100">
        <img src={preview} alt="Preview" className="w-full h-48 object-cover" />
        <button
          onClick={clearPreview}
          className="absolute top-2 right-2 p-1.5 bg-black/50 rounded-full text-white hover:bg-black/70"
          aria-label="Xoá ảnh"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
        isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleInputChange}
        className="hidden"
      />
      <div className="space-y-3">
        <div className="flex justify-center gap-3">
          <button
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-2 btn-primary px-4 py-2"
          >
            <Camera className="w-4 h-4" />
            Chụp ảnh
          </button>
          <button
            onClick={() => {
              if (inputRef.current) {
                inputRef.current.removeAttribute('capture')
                inputRef.current.click()
                inputRef.current.setAttribute('capture', 'environment')
              }
            }}
            className="flex items-center gap-2 btn-secondary px-4 py-2"
          >
            <Upload className="w-4 h-4" />
            Chọn từ thư viện
          </button>
        </div>
        <p className="text-xs text-gray-400">hoặc kéo thả ảnh vào đây</p>
      </div>
    </div>
  )
}
