/**
 * 数据管理设置组件
 * 包含导入、导出功能
 */

import { useState } from 'react'
import { useI18n } from '../i18n'
import { ImportDialog } from './ImportDialog'
import { ExportDialog } from './ExportDialog'
import { PdfImportDialog } from './PdfImportDialog'

type ImporterType = 'markdown' | 'notion' | 'obsidian' | 'pdf'

// 导入来源卡片组件
function ImportSourceCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-start gap-3 p-4 bg-[var(--color-surface)] rounded-lg border border-transparent hover:border-[var(--color-accent)] hover:bg-[var(--color-card)] transition-all text-left w-full"
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-[var(--color-card)] flex items-center justify-center text-[var(--color-accent)]">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-medium text-[var(--color-text)]">{title}</h4>
        <p className="text-xs text-[var(--color-muted)] mt-0.5">{description}</p>
      </div>
      <svg
        className="w-5 h-5 text-[var(--color-muted)] flex-shrink-0 mt-0.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  )
}

// Markdown 图标
function MarkdownIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.56 18H3.44C2.65 18 2 17.37 2 16.59V7.41C2 6.63 2.65 6 3.44 6h17.12c.79 0 1.44.63 1.44 1.41v9.18c0 .78-.65 1.41-1.44 1.41M6.81 15.19v-3.66l1.92 2.35 1.92-2.35v3.66h1.93V8.81h-1.93l-1.92 2.35-1.92-2.35H4.89v6.38h1.92M19.69 12h-1.92V8.81h-1.92V12h-1.93l2.89 3.28L19.69 12z" />
    </svg>
  )
}

// Notion 图标
function NotionIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 2.168c-.42-.326-.98-.7-2.055-.607L3.01 2.77c-.466.046-.56.28-.374.466l1.823.972zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.934-.56.934-1.166V6.354c0-.606-.233-.933-.746-.886l-15.177.887c-.56.047-.748.327-.748.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.746 0-.933-.234-1.495-.933l-4.577-7.186v6.952l1.448.327s0 .84-1.168.84l-3.22.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.454-.233 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.886.747-.933l3.224-.186zM2.335 1.308l13.215-1.166c1.635-.14 2.055-.047 3.082.7l4.249 2.987c.7.513.933.653.933 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.895c0-.84.374-1.54 1.543-1.587z" />
    </svg>
  )
}

// Obsidian 图标
function ObsidianIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 323 413" fill="none" stroke="currentColor" strokeWidth="12">
      <path d="M90.6474 380.398C152.948 254.09 92.4293 196.56 53.635 171.281M114.665 253.194C175.21 238.49 234.073 239.345 275.308 328.127M178.712 246.522C119.858 99.1765 216.59 93.3093 192.634 14.8077M275.308 328.127C276.656 325.663 278.109 323.255 279.675 320.921C296.65 295.606 308.641 275.876 314.71 265.6C317.498 260.884 316.992 254.97 313.693 250.597C305.093 239.203 288.64 216.047 279.675 194.605C270.459 172.563 269.084 138.339 269.005 121.67C268.975 115.334 266.967 109.145 263.048 104.165L193.791 16.1811C193.418 15.7071 193.032 15.2493 192.634 14.8077M275.308 328.127C266.574 344.086 262.221 362.382 260.103 378.124C257.642 396.407 239.753 410.689 221.975 405.758C196.644 398.779 167.315 387.893 140.925 385.865C137.446 385.597 100.478 382.794 100.478 382.794C93.9393 382.328 87.8017 379.47 83.2347 374.767L13.5416 302.994C5.9252 295.151 3.86355 283.455 8.33901 273.48C8.33901 273.48 51.4334 178.764 53.0339 173.839C53.1938 173.346 53.3964 172.475 53.635 171.281M192.634 14.8077C182.866 3.95674 165.996 2.93261 154.974 12.8475L72.5293 87.016C67.931 91.1526 64.9119 96.759 63.9892 102.875C60.8561 123.648 55.7843 160.528 53.635 171.281" />
    </svg>
  )
}

// PDF 图标
function PdfIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
      <path d="M8 12h1.5c.55 0 1 .45 1 1s-.45 1-1 1H9v1.5H8V12zm3.5 0H13c.55 0 1 .45 1 1v2c0 .55-.45 1-1 1h-1.5V12zm1 3.5V13h-.5v2.5h.5zm2-3.5H16c.55 0 1 .45 1 1v2.5h-1V14h-.5v1.5h-1V12z"/>
    </svg>
  )
}

export function DataSettings() {
  const { t } = useI18n()
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [selectedImporter, setSelectedImporter] = useState<ImporterType | null>(null)

  const handleImportClick = (type: ImporterType) => {
    setSelectedImporter(type)
    setShowImportDialog(true)
  }

  const handleCloseImport = () => {
    setShowImportDialog(false)
    setSelectedImporter(null)
  }

  return (
    <div className="space-y-6">
      {/* 导入笔记 */}
      <div>
        <h3 className="text-sm font-medium text-[var(--color-text)] mb-3">
          {t.importExport.importFrom}
        </h3>
        <div className="space-y-2">
          <ImportSourceCard
            icon={<MarkdownIcon />}
            title={t.importExport.markdownImport}
            description={t.importExport.markdownImportDesc}
            onClick={() => handleImportClick('markdown')}
          />
          <ImportSourceCard
            icon={<NotionIcon />}
            title={t.importExport.notionImport}
            description={t.importExport.notionImportDesc}
            onClick={() => handleImportClick('notion')}
          />
          <ImportSourceCard
            icon={<ObsidianIcon />}
            title={t.importExport.obsidianImport}
            description={t.importExport.obsidianImportDesc}
            onClick={() => handleImportClick('obsidian')}
          />
          <ImportSourceCard
            icon={<PdfIcon />}
            title={t.pdfImport?.title || 'PDF'}
            description={t.pdfImport?.description || 'Import PDF files via cloud API (requires API key)'}
            onClick={() => handleImportClick('pdf')}
          />
        </div>
      </div>

      {/* 分隔线 */}
      <div className="border-t border-[var(--color-border)]" />

      {/* 导出笔记 */}
      <div>
        <h3 className="text-sm font-medium text-[var(--color-text)] mb-1">
          {t.importExport.export}
        </h3>
        <p className="text-xs text-[var(--color-muted)] mb-3">
          {t.importExport.exportDescription}
        </p>
        <button
          onClick={() => setShowExportDialog(true)}
          className="px-3 py-1.5 text-sm bg-[var(--color-accent)] text-white rounded-md hover:opacity-90 transition-opacity"
        >
          {t.importExport.exportButton}
        </button>
      </div>

      {/* 导入对话框 */}
      {showImportDialog && selectedImporter && (
        selectedImporter === 'pdf' ? (
          <PdfImportDialog onClose={handleCloseImport} />
        ) : (
          <ImportDialog importerType={selectedImporter} onClose={handleCloseImport} />
        )
      )}

      {/* 导出对话框 */}
      {showExportDialog && <ExportDialog onClose={() => setShowExportDialog(false)} />}
    </div>
  )
}
